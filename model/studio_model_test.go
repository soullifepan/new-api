package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestStudioModelMigratesIdempotentlyOnSQLite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&StudioModel{}))
	require.NoError(t, db.AutoMigrate(&StudioModel{}))
	require.Equal(t, "tap_comfy_models", StudioModel{}.TableName())
	require.True(t, db.Migrator().HasTable(&StudioModel{}))
	require.True(t, db.Migrator().HasTable("tap_comfy_models"))
	require.True(t, db.Migrator().HasColumn(&StudioModel{}, "model_object_key"))
}

func TestStudioModelJSONAndRequiredColumns(t *testing.T) {
	encoded, err := common.Marshal(StudioModel{FileSize: 1, Sort: 2})
	require.NoError(t, err)
	var value map[string]any
	require.NoError(t, common.Unmarshal(encoded, &value))
	require.Equal(t, float64(1), value["file_size"])
	require.Equal(t, float64(2), value["sort"])
}
