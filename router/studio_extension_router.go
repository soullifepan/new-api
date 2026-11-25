package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/studio"

	"github.com/gin-gonic/gin"
)

// SetStudioExtensionRouter mounts the ElevenLabs endpoints the standard relay
// formats cannot carry. They authenticate, rate limit and select channels like
// the other /v1 relay routes.
func SetStudioExtensionRouter(router *gin.Engine) {
	elevenLabsRouter := router.Group("/v1")
	elevenLabsRouter.Use(middleware.RouteTag("relay"))
	elevenLabsRouter.Use(middleware.SystemPerformanceCheck())
	elevenLabsRouter.Use(middleware.TokenAuth())
	elevenLabsRouter.Use(middleware.ModelRequestRateLimit())
	{
		elevenLabsRouter.POST("/sound-generation", studio.PrepareElevenLabsSound, middleware.Distribute(), controller.RelayElevenLabsSound)
		elevenLabsRouter.POST("/audio/speech/with-timestamps", middleware.Distribute(), controller.RelayElevenLabsSpeechWithTimestamps)
		elevenLabsRouter.POST("/music", studio.ElevenLabsMusicModel, middleware.Distribute(), controller.RelayElevenLabsMusic)
		elevenLabsRouter.POST("/elevenlabs/voices", studio.ElevenLabsVoiceModel, middleware.Distribute(), controller.RelayElevenLabsVoiceClone)
		elevenLabsRouter.POST("/extensions/studio/voices/clone", studio.ElevenLabsVoiceModel, middleware.Distribute(), controller.RelayElevenLabsVoiceClone)
		elevenLabsRouter.GET("/elevenlabs/voices", studio.ElevenLabsVoiceModel, middleware.Distribute(), controller.RelayElevenLabsVoiceList)
		elevenLabsRouter.GET("/elevenlabs/voices/:voice_id", studio.ElevenLabsVoiceModel, middleware.Distribute(), controller.RelayElevenLabsVoiceGet)
		elevenLabsRouter.POST("/elevenlabs/voices/:voice_id/edit", studio.ElevenLabsVoiceModel, middleware.Distribute(), controller.RelayElevenLabsVoiceEdit)
		elevenLabsRouter.DELETE("/elevenlabs/voices/:voice_id", studio.ElevenLabsVoiceModel, middleware.Distribute(), controller.RelayElevenLabsVoiceDelete)
	}
}
