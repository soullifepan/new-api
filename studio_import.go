package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/studio"
)

const (
	legacySupabaseURLEnv         = "STUDIO_LEGACY_SUPABASE_URL"
	legacySupabaseURLFallbackEnv = "TAPCOMFY_LEGACY_SUPABASE_URL"
	legacySupabaseKeyEnv         = "STUDIO_LEGACY_SUPABASE_SERVICE_ROLE_KEY"
	legacySupabaseKeyFallbackEnv = "TAPCOMFY_LEGACY_SUPABASE_SERVICE_ROLE_KEY"
	legacyModelsFileEnv          = "STUDIO_LEGACY_MODELS_FILE"
	legacyModelsFileFallbackEnv  = "TAPCOMFY_LEGACY_MODELS_FILE"
)

func runStudioLegacyImport(args []string) int {
	flags := flag.NewFlagSet("studio-import-models", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	dryRun := flags.Bool("dry-run", false, "validate legacy catalogue access without writing data")
	preserveLegacyAssets := flags.Bool("preserve-legacy-assets", false, "keep verified legacy public asset URLs instead of copying them")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	legacyFile := strings.TrimSpace(os.Getenv(legacyModelsFileEnv))
	if legacyFile == "" {
		legacyFile = strings.TrimSpace(os.Getenv(legacyModelsFileFallbackEnv))
	}
	var rows []studio.LegacyModel
	var err error
	if legacyFile != "" {
		rows, err = studio.LoadLegacyModelsFile(legacyFile)
	} else {
		legacyURL := strings.TrimSpace(os.Getenv(legacySupabaseURLEnv))
		if legacyURL == "" {
			legacyURL = strings.TrimSpace(os.Getenv(legacySupabaseURLFallbackEnv))
		}
		legacyKey := strings.TrimSpace(os.Getenv(legacySupabaseKeyEnv))
		if legacyKey == "" {
			legacyKey = strings.TrimSpace(os.Getenv(legacySupabaseKeyFallbackEnv))
		}
		if legacyURL == "" || legacyKey == "" {
			fmt.Fprintln(os.Stderr, "Studio legacy catalogue source is not configured")
			return 1
		}
		rows, err = studio.FetchLegacyModels(ctx, legacyURL, legacyKey, 1000)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "Studio legacy catalogue import failed")
		return 1
	}
	if *dryRun {
		fmt.Fprintf(os.Stdout, "Studio legacy catalogue dry run succeeded: rows=%d\n", len(rows))
		return 0
	}

	common.InitEnv()
	if err := model.InitDB(); err != nil {
		fmt.Fprintln(os.Stderr, "Studio import database initialization failed")
		return 1
	}
	// This command only opens the primary database. Keep CloseDB from trying to
	// close an uninitialized log database after an import failure.
	model.LOG_DB = model.DB
	defer model.CloseDB()
	config := studio.LoadConfig()
	uploader := config.CopyLegacyAsset
	if *preserveLegacyAssets {
		uploader = studio.LegacyAssetReference
	}
	result, err := studio.ImportLegacyModels(ctx, model.DB, rows, uploader)
	if err != nil {
		if errors.Is(err, studio.ErrInvalidAsset) {
			fmt.Fprintln(os.Stderr, "Studio legacy catalogue import failed: an asset did not satisfy validation")
		} else if errors.Is(err, studio.ErrNotConfigured) {
			fmt.Fprintln(os.Stderr, "Studio legacy catalogue import failed: storage is not configured")
		} else {
			fmt.Fprintln(os.Stderr, "Studio legacy catalogue import failed: an asset transfer failed")
		}
		return 1
	}
	fmt.Fprintf(os.Stdout, "Studio legacy catalogue import completed: created=%d skipped=%d\n", result.Created, result.Skipped)
	return 0
}
