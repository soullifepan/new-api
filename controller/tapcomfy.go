package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/tapcomfy"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func GetTapComfyStorageSTS(c *gin.Context) {
	credentials, err := tapcomfy.LoadConfig().AssumeRole(c.Request.Context())
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, tapcomfy.ErrNotConfigured) {
			status = http.StatusServiceUnavailable
		}
		c.JSON(status, gin.H{"error": "TapComfy storage is unavailable"})
		return
	}
	c.JSON(http.StatusOK, credentials)
}

func GetTapComfyModels(c *gin.Context) {
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
	query := model.DB.Model(&model.TapComfyModel{}).Where("status = ?", model.TapComfyModelStatusPublished)
	if category := strings.TrimSpace(c.Query("category")); category != "" {
		query = query.Where("category = ?", category)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "catalog unavailable"})
		return
	}
	var models []model.TapComfyModel
	if err := query.Order("sort ASC").Order("created_at DESC").Limit(limit).Offset((page - 1) * limit).Find(&models).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "catalog unavailable"})
		return
	}
	data := make([]tapComfyPublicModel, 0, len(models))
	for _, item := range models {
		data = append(data, tapComfyPublicModel{ID: item.ID, Name: item.Name, Category: item.Category, ThumbnailURL: item.ThumbnailURL, ModelURL: item.ModelURL, Format: item.Format, FileSize: item.FileSize, Sort: item.Sort})
	}
	c.JSON(http.StatusOK, gin.H{"data": data, "page": page, "limit": limit, "total": total})
}

type tapComfyPublicModel struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Category     string `json:"category"`
	ThumbnailURL string `json:"thumbnail_url"`
	ModelURL     string `json:"model_url"`
	Format       string `json:"format"`
	FileSize     int64  `json:"file_size"`
	Sort         int    `json:"sort"`
}

func GetTapComfyAdminModels(c *gin.Context) {
	var models []model.TapComfyModel
	if err := model.DB.Order("sort ASC").Order("created_at DESC").Find(&models).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "catalog unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": models})
}

type tapComfyModelInput struct {
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

func (input tapComfyModelInput) valid() bool {
	if strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.Category) == "" || input.FileSize <= 0 || (input.Status != model.TapComfyModelStatusPublished && input.Status != model.TapComfyModelStatusHidden) {
		return false
	}
	format := "." + strings.TrimPrefix(strings.ToLower(input.Format), ".")
	if !map[string]bool{".glb": true, ".gltf": true, ".fbx": true, ".obj": true}[format] || !strings.HasSuffix(input.ModelObjectKey, format) {
		return false
	}
	return tapcomfy.LoadConfig().ValidateAssetReference("3d-model", input.ModelObjectKey, input.ModelURL) && tapcomfy.LoadConfig().ValidateAssetReference("3d-thumbnail", input.ThumbnailObjectKey, input.ThumbnailURL)
}

func (input tapComfyModelInput) validForUpdate(existing model.TapComfyModel) bool {
	if strings.TrimSpace(input.Name) == "" || strings.TrimSpace(input.Category) == "" || input.FileSize <= 0 || (input.Status != model.TapComfyModelStatusPublished && input.Status != model.TapComfyModelStatusHidden) {
		return false
	}
	format := "." + strings.TrimPrefix(strings.ToLower(input.Format), ".")
	if !map[string]bool{".glb": true, ".gltf": true, ".fbx": true, ".obj": true}[format] || !strings.HasSuffix(input.ModelObjectKey, format) {
		return false
	}
	config := tapcomfy.LoadConfig()
	modelReferenceValid := config.ValidateAssetReference("3d-model", input.ModelObjectKey, input.ModelURL) || (input.ModelObjectKey == existing.ModelObjectKey && input.ModelURL == existing.ModelURL)
	thumbnailReferenceValid := config.ValidateAssetReference("3d-thumbnail", input.ThumbnailObjectKey, input.ThumbnailURL) || (input.ThumbnailObjectKey == existing.ThumbnailObjectKey && input.ThumbnailURL == existing.ThumbnailURL)
	return modelReferenceValid && thumbnailReferenceValid
}
func CreateTapComfyModel(c *gin.Context) {
	var input tapComfyModelInput
	if err := c.ShouldBindJSON(&input); err != nil || !input.valid() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid model"})
		return
	}
	item := model.TapComfyModel{ID: uuid.NewString(), Name: strings.TrimSpace(input.Name), Category: strings.TrimSpace(input.Category), ThumbnailURL: input.ThumbnailURL, ThumbnailObjectKey: input.ThumbnailObjectKey, ModelURL: input.ModelURL, ModelObjectKey: input.ModelObjectKey, Format: strings.TrimPrefix(strings.ToLower(input.Format), "."), FileSize: input.FileSize, Sort: input.Sort, Status: input.Status}
	if err := model.DB.Create(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to create model"})
		return
	}
	c.JSON(http.StatusCreated, item)
}
func UpdateTapComfyModel(c *gin.Context) {
	var input tapComfyModelInput
	var item model.TapComfyModel
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
func DeleteTapComfyModel(c *gin.Context) {
	if result := model.DB.Where("id = ?", c.Param("id")).Delete(&model.TapComfyModel{}); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unable to delete model"})
	} else if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "model not found"})
	} else {
		c.Status(http.StatusNoContent)
	}
}

func UploadTapComfyAsset(c *gin.Context) {
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
	asset, err := tapcomfy.LoadConfig().UploadAsset(c.Request.Context(), assetType, file.Filename, file.Header.Get("Content-Type"), file.Size, reader)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, tapcomfy.ErrNotConfigured) {
			status = http.StatusServiceUnavailable
		} else if !errors.Is(err, tapcomfy.ErrInvalidAsset) {
			status = http.StatusBadGateway
		}
		c.JSON(status, gin.H{"error": "TapComfy asset upload failed"})
		return
	}
	c.JSON(http.StatusOK, asset)
}
