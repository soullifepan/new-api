package controller

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/studio"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func ReportStudioClientLog(c *gin.Context) {
	userID := c.GetInt("id")
	if userID <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "client diagnostic is too large"})
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid client diagnostic"})
		}
		return
	}
	var input studio.ClientLogInput
	if err := common.Unmarshal(body, &input); err != nil || input.Validate() != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid client diagnostic"})
		return
	}
	if err := studio.LoadClientLogConfig().Send(c.Request.Context(), userID, input); err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, studio.ErrNotConfigured) {
			status = http.StatusServiceUnavailable
		}
		c.JSON(status, gin.H{"error": "client diagnostics are unavailable"})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"success": true})
}

func GetStudioStorageSTS(c *gin.Context) {
	credentials, err := studio.LoadConfig().AssumeRole(c.Request.Context(), c.GetInt("id"))
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, studio.ErrNotConfigured) {
			status = http.StatusServiceUnavailable
		} else if errors.Is(err, studio.ErrInvalidStorageUser) {
			status = http.StatusUnauthorized
		}
		c.JSON(status, gin.H{"error": "Studio storage is unavailable"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, credentials)
}

func GetStudioModels(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	query := model.DB.Model(&model.StudioModel{}).Where("status = ?", model.StudioModelStatusPublished)
	if category := strings.TrimSpace(c.Query("category")); category != "" {
		query = query.Where("category = ?", category)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "catalog unavailable"})
		return
	}
	var models []model.StudioModel
	if err := query.Order("sort ASC").Order("created_at DESC").Limit(limit).Offset((page - 1) * limit).Find(&models).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "catalog unavailable"})
		return
	}
	data := make([]studioPublicModel, 0, len(models))
	for _, item := range models {
		data = append(data, studioPublicModel{ID: item.ID, Name: item.Name, Category: item.Category, ThumbnailURL: item.ThumbnailURL, ModelURL: item.ModelURL, Format: item.Format, FileSize: item.FileSize, Sort: item.Sort})
	}
	c.JSON(http.StatusOK, gin.H{"data": data, "page": page, "limit": limit, "total": total})
}

type studioPublicModel struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Category     string `json:"category"`
	ThumbnailURL string `json:"thumbnail_url"`
	ModelURL     string `json:"model_url"`
	Format       string `json:"format"`
	FileSize     int64  `json:"file_size"`
	Sort         int    `json:"sort"`
}

func GetStudioAdminModels(c *gin.Context) {
	var models []model.StudioModel
	if err := model.DB.Order("sort ASC").Order("created_at DESC").Find(&models).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "catalog unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": models})
}

type studioModelInput struct {
	Name               string `json:"name"`
	Category           string `json:"category"`
	ThumbnailURL       string `json:"thumbnail_url"`
	ThumbnailObjectKey string `json:"thumbnail_object_key"`
	ModelURL           string `json:"model_url"`
	ModelObjectKey     string `json:"model_object_key"`
	Format             string `json:"format"`
	FileSize           int64  `json:"file_size"`
	Sort               int    `json:"sort"`
	Status             string `json:"status"`
}

func (input studioModelInput) valid() bool {
	if strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.Category) == "" || input.FileSize <= 0 || (input.Status != model.StudioModelStatusPublished && input.Status != model.StudioModelStatusHidden) {
		return false
	}
	format := "." + strings.TrimPrefix(strings.ToLower(input.Format), ".")
	if !map[string]bool{".glb": true, ".gltf": true, ".fbx": true, ".obj": true}[format] || !strings.HasSuffix(input.ModelObjectKey, format) {
		return false
	}
	return studio.LoadConfig().ValidateAssetReference("3d-model", input.ModelObjectKey, input.ModelURL) && studio.LoadConfig().ValidateAssetReference("3d-thumbnail", input.ThumbnailObjectKey, input.ThumbnailURL)
}

func (input studioModelInput) validForUpdate(existing model.StudioModel) bool {
	if strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.Category) == "" || input.FileSize <= 0 || (input.Status != model.StudioModelStatusPublished && input.Status != model.StudioModelStatusHidden) {
		return false
	}
	format := "." + strings.TrimPrefix(strings.ToLower(input.Format), ".")
	if !map[string]bool{".glb": true, ".gltf": true, ".fbx": true, ".obj": true}[format] || !strings.HasSuffix(input.ModelObjectKey, format) {
		return false
	}
	config := studio.LoadConfig()
	modelReferenceValid := config.ValidateAssetReference("3d-model", input.ModelObjectKey, input.ModelURL) || (input.ModelObjectKey == existing.ModelObjectKey && input.ModelURL == existing.ModelURL)
	thumbnailReferenceValid := config.ValidateAssetReference("3d-thumbnail", input.ThumbnailObjectKey, input.ThumbnailURL) || (input.ThumbnailObjectKey == existing.ThumbnailObjectKey && input.ThumbnailURL == existing.ThumbnailURL)
	return modelReferenceValid && thumbnailReferenceValid
}
func CreateStudioModel(c *gin.Context) {
	var input studioModelInput
	if err := c.ShouldBindJSON(&input); err != nil || !input.valid() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid model"})
		return
	}
	item := model.StudioModel{ID: uuid.NewString(), Name: strings.TrimSpace(input.Name), Category: strings.TrimSpace(input.Category), ThumbnailURL: input.ThumbnailURL, ThumbnailObjectKey: input.ThumbnailObjectKey, ModelURL: input.ModelURL, ModelObjectKey: input.ModelObjectKey, Format: strings.TrimPrefix(strings.ToLower(input.Format), "."), FileSize: input.FileSize, Sort: input.Sort, Status: input.Status}
	if err := model.DB.Create(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to create model"})
		return
	}
	c.JSON(http.StatusCreated, item)
}
func UpdateStudioModel(c *gin.Context) {
	var input studioModelInput
	var item model.StudioModel
	if err := model.DB.Where("id = ?", c.Param("id")).First(&item).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "model not found"})
		return
	}
	if err := c.ShouldBindJSON(&input); err != nil || !input.validForUpdate(item) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid model"})
		return
	}
	item.Name = strings.TrimSpace(input.Name)
	item.Category = strings.TrimSpace(input.Category)
	item.ThumbnailURL = input.ThumbnailURL
	item.ThumbnailObjectKey = input.ThumbnailObjectKey
	item.ModelURL = input.ModelURL
	item.ModelObjectKey = input.ModelObjectKey
	item.Format = strings.TrimPrefix(strings.ToLower(input.Format), ".")
	item.FileSize = input.FileSize
	item.Sort = input.Sort
	item.Status = input.Status
	if err := model.DB.Save(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to update model"})
		return
	}
	c.JSON(http.StatusOK, item)
}
func DeleteStudioModel(c *gin.Context) {
	if result := model.DB.Where("id = ?", c.Param("id")).Delete(&model.StudioModel{}); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to delete model"})
	} else if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "model not found"})
	} else {
		c.Status(http.StatusNoContent)
	}
}

func UploadStudioAsset(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 101<<20)
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}
	assetType := c.PostForm("assetType")
	reader, err := file.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file"})
		return
	}
	defer reader.Close()
	asset, err := studio.LoadConfig().UploadAsset(c.Request.Context(), assetType, file.Filename, file.Header.Get("Content-Type"), file.Size, reader)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, studio.ErrNotConfigured) {
			status = http.StatusServiceUnavailable
		} else if !errors.Is(err, studio.ErrInvalidAsset) {
			status = http.StatusBadGateway
		}
		c.JSON(status, gin.H{"error": "Studio asset upload failed"})
		return
	}
	c.JSON(http.StatusOK, asset)
}
