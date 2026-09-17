package model

import "time"

const (
	TapComfyModelStatusPublished = "published"
	TapComfyModelStatusHidden    = "hidden"
)

// TapComfyModel is the public 3D preset catalogue. Object keys are retained so
// administrative changes never infer ownership from a mutable public URL.
type TapComfyModel struct {
	ID                 string    `json:"id" gorm:"type:varchar(64);primaryKey"`
	Name               string    `json:"name" gorm:"type:varchar(128);not null;index"`
	Category           string    `json:"category" gorm:"type:varchar(32);not null;index"`
	ThumbnailURL       string    `json:"thumbnail_url" gorm:"type:text;not null"`
	ThumbnailObjectKey string    `json:"thumbnail_object_key" gorm:"type:varchar(512);not null"`
	ModelURL           string    `json:"model_url" gorm:"type:text;not null"`
	ModelObjectKey     string    `json:"model_object_key" gorm:"type:varchar(512);not null"`
	Format             string    `json:"format" gorm:"type:varchar(16);not null"`
	FileSize           int64     `json:"file_size;not null"`
	Sort               int       `json:"sort;not null;index"`
	Status             string    `json:"status" gorm:"type:varchar(16);not null;index"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}
