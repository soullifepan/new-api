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
	"github.com/QuantumNous/new-api/tapcomfy"
)

const (
	legacySupabaseURLEnv = "TAPCOMFY_LEGACY_SUPABASE_URL"
	legacySupabaseKeyEnv = "TAPCOMFY_LEGACY_SUPABASE_SERVICE_ROLE_KEY"
	legacyModelsFileEnv  = "TAPCOMFY_LEGACY_MODELS_FILE"
)

func runTapComfyLegacyImport(args []string) int {
	flags := flag.NewFlagSet("tapcomfy-import-models", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	dryRun := flags.Bool("dry-run", false, "validate legacy catalogue access without writing data")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	legacyFile := strings.TrimSpace(os.Getenv(legacyModelsFileEnv))
	var rows []tapcomfy.LegacyModel
	var err error
	if legacyFile != "" {
		rows, err = tapcomfy.LoadLegacyModelsFile(legacyFile)
	} else {
		legacyURL := strings.TrimSpace(os.Getenv(legacySupabaseURLEnv))
		legacyKey := strings.TrimSpace(os.Getenv(legacySupabaseKeyEnv))
		if legacyURL == "" || legacyKey == "" {
			fmt.Fprintln(os.Stderr, "TapComfy legacy catalogue source is not configured")
			return 1
		}
		rows, err = tapcomfy.FetchLegacyModels(ctx, legacyURL, legacyKey, 1000)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "TapComfy legacy catalogue import failed")
		return 1
	}
	if *dryRun {
		fmt.Fprintf(os.Stdout, "TapComfy legacy catalogue dry run succeeded: rows=%d\n", len(rows))
		return 0
	}

	common.InitEnv()
	if err := model.InitDB(); err != nil {
		fmt.Fprintln(os.Stderr, "TapComfy import database initialization failed")
		return 1
	}
	// This command only opens the primary database. Keep CloseDB from trying to
	// close an uninitialized log database after an import failure.
	model.LOG_DB = model.DB
	defer model.CloseDB()
	config := tapcomfy.LoadConfig()
	result, err := tapcomfy.ImportLegacyModels(ctx, model.DB, rows, config.CopyLegacyAsset)
	if err != nil {
		if errors.Is(err, tapcomfy.ErrInvalidAsset) {
			fmt.Fprintln(os.Stderr, "TapComfy legacy catalogue import failed: an asset did not satisfy validation")
		} else if errors.Is(err, tapcomfy.ErrNotConfigured) {
			fmt.Fprintln(os.Stderr, "TapComfy legacy catalogue import failed: storage is not configured")
		} else {
			fmt.Fprintln(os.Stderr, "TapComfy legacy catalogue import failed: an asset transfer failed")
		}
		return 1
	}
	fmt.Fprintf(os.Stdout, "TapComfy legacy catalogue import completed: created=%d skipped=%d\n", result.Created, result.Skipped)
	return 0
}
