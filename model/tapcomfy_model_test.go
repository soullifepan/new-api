package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestTapComfyModelMigratesIdempotentlyOnSQLite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&TapComfyModel{}))
	require.NoError(t, db.AutoMigrate(&TapComfyModel{}))
	require.True(t, db.Migrator().HasTable(&TapComfyModel{}))
	require.True(t, db.Migrator().HasColumn(&TapComfyModel{}, "model_object_key"))
}
