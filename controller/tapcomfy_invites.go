package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type tapComfyInvitedUser struct {
	Username  string `json:"username"`
	CreatedAt int64  `json:"created_at"`
}

func GetTapComfyInvitedUsers(c *gin.Context) {
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 || page > 1_000_000 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid page"})
		return
	}
	const pageSize = 20
	query := model.DB.Model(&model.User{}).Where("inviter_id = ?", c.GetInt("id"))
	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Unable to load invitations"})
		return
	}
	items := make([]tapComfyInvitedUser, 0)
	if err := query.Select("username", "created_at").Order("id DESC").Limit(pageSize).Offset((page - 1) * pageSize).Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Unable to load invitations"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": items, "total": total, "page": page}})
}
