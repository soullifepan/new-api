package tapcomfy

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

// LegacyModel is the minimum stable shape of a legacy Supabase models row.
// URLs remain inputs only: the importer copies them into the configured assets
// bucket and stores only the resulting New API references.
type LegacyModel struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Category  string `json:"category"`
	ImageURL  string `json:"image_url"`
	ModelURL  string `json:"model_url"`
	CreatedAt string `json:"created_at"`
	Sort      int    `json:"sort"`
}

type LegacyImportResult struct {
	Created int
	Skipped int
}

// LegacyAssetUploader copies one legacy public asset into the configured
// TapComfy assets bucket. It returns the server-generated reference and size.
type LegacyAssetUploader func(context.Context, string, string) (*UploadedAsset, int64, error)

const (
	legacyImportPageSize = 1000
	legacyImportMaxRows  = 10000
)

// FetchLegacyModels reads only the legacy catalogue rows required for a
// one-time migration. The supplied API key is never included in errors.
func FetchLegacyModels(ctx context.Context, baseURL, serviceRoleKey string, pageSize int) ([]LegacyModel, error) {
	return fetchLegacyModels(ctx, legacyHTTPClient(), baseURL, serviceRoleKey, pageSize)
}

// LoadLegacyModelsFile reads a locally exported legacy catalogue. It lets an
// operator keep a legacy service-role credential off the New API host when the
// legacy service only exposes an insecure endpoint.
func LoadLegacyModelsFile(filename string) ([]LegacyModel, error) {
	file, err := os.Open(filename)
	if err != nil {
		return nil, errors.New("legacy catalogue file is unavailable")
	}
	defer file.Close()
	var rows []LegacyModel
	if err := common.DecodeJson(io.LimitReader(file, 16<<20), &rows); err != nil || len(rows) == 0 || len(rows) > legacyImportMaxRows {
		return nil, errors.New("legacy catalogue file is invalid")
	}
	return rows, nil
}

func fetchLegacyModels(ctx context.Context, client *http.Client, baseURL, serviceRoleKey string, pageSize int) ([]LegacyModel, error) {
	baseURL = strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	if baseURL == "" || strings.TrimSpace(serviceRoleKey) == "" {
		return nil, errors.New("legacy catalogue is not configured")
	}
	if pageSize <= 0 || pageSize > legacyImportPageSize {
		pageSize = legacyImportPageSize
	}
	endpoint, err := url.Parse(baseURL + "/rest/v1/models")
	if err != nil || endpoint.Scheme != "https" || endpoint.Host == "" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return nil, errors.New("legacy catalogue URL is invalid")
	}
	query := endpoint.Query()
	query.Set("select", "id,name,category,image_url,model_url,created_at,sort")
	query.Set("order", "sort.asc,created_at.desc")
	endpoint.RawQuery = query.Encode()

	rows := make([]LegacyModel, 0)
	for start := 0; start < legacyImportMaxRows; start += pageSize {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
		if err != nil {
			return nil, err
		}
		request.Header.Set("apikey", serviceRoleKey)
		request.Header.Set("Authorization", "Bearer "+serviceRoleKey)
		request.Header.Set("Range", fmt.Sprintf("%d-%d", start, start+pageSize-1))
		response, err := client.Do(request)
		if err != nil {
			return nil, fmt.Errorf("read legacy catalogue: %w", err)
		}
		if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
			response.Body.Close()
			return nil, fmt.Errorf("legacy catalogue returned status %d", response.StatusCode)
		}
		var page []LegacyModel
		err = common.DecodeJson(response.Body, &page)
		response.Body.Close()
		if err != nil {
			return nil, errors.New("legacy catalogue response is invalid")
		}
		if len(rows)+len(page) > legacyImportMaxRows {
			return nil, errors.New("legacy catalogue exceeds migration limit")
		}
		rows = append(rows, page...)
		if len(page) < pageSize {
			return rows, nil
		}
	}
	return nil, errors.New("legacy catalogue exceeds migration limit")
}

// CopyLegacyAsset downloads a legacy public file with bounded I/O, then sends
// it through the same validation and OSS upload path as the admin API.
func (c Config) CopyLegacyAsset(ctx context.Context, assetType, sourceURL string) (*UploadedAsset, int64, error) {
	parsed, err := parseLegacyAssetURL(sourceURL, assetType)
	if err != nil {
		return nil, 0, err
	}
	directory, maxSize, _ := assetRules(assetType)
	if directory == "" {
		return nil, 0, ErrInvalidAsset
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, 0, err
	}
	response, err := legacyHTTPClient().Do(request)
	if err != nil {
		return nil, 0, errors.New("download legacy asset failed")
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, 0, fmt.Errorf("legacy asset returned status %d", response.StatusCode)
	}
	if response.ContentLength <= 0 || response.ContentLength > maxSize {
		return nil, 0, ErrInvalidAsset
	}
	temporary, err := os.CreateTemp("", "tapcomfy-legacy-asset-*")
	if err != nil {
		return nil, 0, err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	defer temporary.Close()
	size, err := io.Copy(temporary, io.LimitReader(response.Body, maxSize+1))
	if err != nil || size <= 0 || size > maxSize {
		return nil, 0, ErrInvalidAsset
	}
	if _, err = temporary.Seek(0, io.SeekStart); err != nil {
		return nil, 0, err
	}
	probe := make([]byte, 512)
	n, readErr := temporary.Read(probe)
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		return nil, 0, readErr
	}
	if _, err = temporary.Seek(0, io.SeekStart); err != nil {
		return nil, 0, err
	}
	asset, err := c.UploadAsset(ctx, assetType, path.Base(parsed.Path), legacyDeclaredContentType(assetType, probe[:n]), size, temporary)
	if err != nil {
		return nil, 0, err
	}
	return asset, size, nil
}

// LegacyAssetReference preserves a verified legacy public object when copying
// into OSS is unavailable. It is used only by the one-time importer; admin
// uploads remain constrained to the new fixed directories.
func LegacyAssetReference(ctx context.Context, assetType, sourceURL string) (*UploadedAsset, int64, error) {
	parsed, err := parseLegacyAssetURL(sourceURL, assetType)
	if err != nil {
		return nil, 0, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodHead, parsed.String(), nil)
	if err != nil {
		return nil, 0, err
	}
	response, err := legacyHTTPClient().Do(request)
	if err != nil || response == nil {
		return nil, 0, errors.New("legacy asset reference check failed")
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices || response.ContentLength <= 0 {
		return nil, 0, errors.New("legacy asset reference check failed")
	}
	return &UploadedAsset{URL: parsed.String(), ObjectKey: strings.TrimPrefix(parsed.EscapedPath(), "/"), AssetType: assetType}, response.ContentLength, nil
}

func legacyDeclaredContentType(assetType string, content []byte) string {
	if assetType == "3d-model" {
		return ""
	}
	return http.DetectContentType(content)
}

func legacyHTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{Timeout: storageConnectTimeout}).DialContext
	return &http.Client{Timeout: 2 * time.Minute, Transport: &rejectRedirectTransport{base: transport}}
}

// ImportLegacyModels imports metadata after each legacy file has been copied
// through the same asset boundary used by the admin API. Existing IDs are
// deliberately skipped so interrupted imports can be rerun safely.
func ImportLegacyModels(ctx context.Context, db *gorm.DB, rows []LegacyModel, upload LegacyAssetUploader) (LegacyImportResult, error) {
	if db == nil || upload == nil {
		return LegacyImportResult{}, errors.New("legacy import is not configured")
	}
	result := LegacyImportResult{}
	for _, row := range rows {
		if err := validateLegacyModel(row); err != nil {
			return result, err
		}
		var existing model.TapComfyModel
		err := db.Where("id = ?", row.ID).First(&existing).Error
		if err == nil {
			result.Skipped++
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return result, fmt.Errorf("find legacy model: %w", err)
		}

		thumbnail, _, err := upload(ctx, "3d-thumbnail", row.ImageURL)
		if err != nil {
			return result, fmt.Errorf("copy legacy thumbnail: %w", err)
		}
		if !validImportedAsset("3d-thumbnail", thumbnail) {
			return result, errors.New("legacy thumbnail copy returned an invalid reference")
		}
		asset, size, err := upload(ctx, "3d-model", row.ModelURL)
		if err != nil {
			return result, fmt.Errorf("copy legacy model: %w", err)
		}
		if size <= 0 || !validImportedAsset("3d-model", asset) {
			return result, errors.New("legacy model copy returned an invalid reference")
		}

		createdAt := time.Now()
		if row.CreatedAt != "" {
			parsed, err := time.Parse(time.RFC3339Nano, row.CreatedAt)
			if err != nil {
				return result, fmt.Errorf("invalid legacy created_at: %w", err)
			}
			createdAt = parsed
		}
		item := model.TapComfyModel{
			ID:                 row.ID,
			Name:               strings.TrimSpace(row.Name),
			Category:           strings.TrimSpace(row.Category),
			ThumbnailURL:       thumbnail.URL,
			ThumbnailObjectKey: thumbnail.ObjectKey,
			ModelURL:           asset.URL,
			ModelObjectKey:     asset.ObjectKey,
			Format:             strings.TrimPrefix(strings.ToLower(path.Ext(asset.ObjectKey)), "."),
			FileSize:           size,
			Sort:               row.Sort,
			Status:             model.TapComfyModelStatusPublished,
			CreatedAt:          createdAt,
			UpdatedAt:          time.Now(),
		}
		if err := db.Create(&item).Error; err != nil {
			return result, fmt.Errorf("create imported model: %w", err)
		}
		result.Created++
	}
	return result, nil
}

func validateLegacyModel(row LegacyModel) error {
	if strings.TrimSpace(row.ID) == "" || strings.TrimSpace(row.Name) == "" || strings.TrimSpace(row.Category) == "" {
		return errors.New("legacy model has required fields missing")
	}
	if _, err := parseLegacyAssetURL(row.ImageURL, "3d-thumbnail"); err != nil {
		return err
	}
	if _, err := parseLegacyAssetURL(row.ModelURL, "3d-model"); err != nil {
		return err
	}
	return nil
}

func parseLegacyAssetURL(rawURL, assetType string) (*url.URL, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("legacy asset URL is invalid")
	}
	// Legacy rows contain a small number of HTTP links. Upgrade only to HTTPS
	// before downloading so the migration never sends requests over plaintext.
	u.Scheme = "https"
	_, _, allowed := assetRules(assetType)
	if !allowed[strings.ToLower(path.Ext(u.Path))] {
		return nil, errors.New("legacy asset type is unsupported")
	}
	return u, nil
}

func validImportedAsset(assetType string, asset *UploadedAsset) bool {
	if asset == nil || asset.AssetType != assetType || asset.URL == "" {
		return false
	}
	directory, _, allowed := assetRules(assetType)
	if !allowed[strings.ToLower(path.Ext(asset.ObjectKey))] {
		return false
	}
	return strings.HasPrefix(asset.ObjectKey, directory) || (strings.HasPrefix(asset.ObjectKey, "3d_models/") && !strings.Contains(asset.ObjectKey, "..") && !strings.ContainsAny(asset.ObjectKey, "\\?#"))
}
