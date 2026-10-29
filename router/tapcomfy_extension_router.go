package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/tapcomfy"

	"github.com/gin-gonic/gin"
)

// SetTapComfyExtensionRouter mounts the ElevenLabs endpoints the standard relay
// formats cannot carry. They authenticate, rate limit and select channels like
// the other /v1 relay routes.
func SetTapComfyExtensionRouter(router *gin.Engine) {
	elevenLabsRouter := router.Group("/v1")
	elevenLabsRouter.Use(middleware.RouteTag("relay"))
	elevenLabsRouter.Use(middleware.SystemPerformanceCheck())
	elevenLabsRouter.Use(middleware.TokenAuth())
	elevenLabsRouter.Use(middleware.ModelRequestRateLimit())
	{
		elevenLabsRouter.POST("/audio/speech/with-timestamps", middleware.Distribute(), controller.RelayElevenLabsSpeechWithTimestamps)
		elevenLabsRouter.POST("/music", tapcomfy.ElevenLabsMusicModel, middleware.Distribute(), controller.RelayElevenLabsMusic)
	}
}
