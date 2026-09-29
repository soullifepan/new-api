package controller

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func partnerError(c *gin.Context, err error) {
	status, message := http.StatusInternalServerError, "合作伙伴服务暂不可用"
	code := "partner_unavailable"
	switch {
	case errors.Is(err, model.ErrPartnerInvalid):
		status, message = http.StatusBadRequest, err.Error()
		code = "partner_invalid"
	case errors.Is(err, model.ErrPartnerState), errors.Is(err, model.ErrPartnerFunds), errors.Is(err, model.ErrPartnerQuote):
		status, message = http.StatusConflict, err.Error()
		code = "partner_state"
		if errors.Is(err, model.ErrPartnerFunds) {
			code = "partner_funds"
		}
		if errors.Is(err, model.ErrPartnerQuote) {
			code = "partner_quote_changed"
		}
	case errors.Is(err, model.ErrTopUpQuotaLimitExceeded):
		status, message = http.StatusConflict, "消费余额已达上限"
		code = "wallet_limit"
	case errors.Is(err, gorm.ErrRecordNotFound):
		status, message = http.StatusNotFound, "记录不存在"
		code = "partner_not_found"
	}
	c.JSON(status, gin.H{"success": false, "message": message, "code": code})
}

func GetPartnerOverview(c *gin.Context) {
	userID := c.GetInt("id")
	partner, err := model.GetPartner(userID)
	if err != nil {
		partnerError(c, err)
		return
	}
	user, err := model.GetUserById(userID, false)
	if err != nil {
		partnerError(c, err)
		return
	}
	money, err := model.PartnerMoneyForGroup(user.Group)
	if err != nil {
		partnerError(c, err)
		return
	}
	var invited int64
	if err := model.DB.Model(&model.User{}).Where("inviter_id = ?", userID).Count(&invited).Error; err != nil {
		partnerError(c, err)
		return
	}
	var totals struct {
		TopupCount int64 `json:"topup_count"`
		TopupQuota int64 `json:"topup_quota"`
	}
	if err := model.DB.Model(&model.PartnerCommission{}).Select("COUNT(*) AS topup_count, COALESCE(SUM(top_up_quota),0) AS topup_quota").Where("partner_id = ?", userID).Scan(&totals).Error; err != nil {
		partnerError(c, err)
		return
	}
	funds := partner
	if funds == nil {
		funds = &model.Partner{}
	}
	config := model.GetPartnerConfig()
	config = model.EffectivePartnerConfig(partner, config)
	var remaining *int64
	if config.AlipayDailyLimitCents > 0 {
		used, err := model.PartnerAlipayUsedCents(model.DB, userID)
		if err != nil {
			partnerError(c, err)
			return
		}
		value := max(int64(0), config.AlipayDailyLimitCents-used)
		remaining = &value
	}
	code := ""
	if funds.Status == "approved" {
		code = user.AffCode
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"application": partner, "config": config, "money": money, "referral_code": code, "summary": gin.H{"invited_count": invited, "topup_count": totals.TopupCount, "topup_quota": totals.TopupQuota, "earned_quota": funds.EarnedQuota, "available_quota": funds.AvailableQuota, "reserved_quota": funds.ReservedQuota, "withdrawn_quota": funds.WithdrawnQuota, "transferred_quota": funds.TransferredQuota, "alipay_remaining_cents": remaining}}})
}

// GetPartnerAccess is the lightweight, authenticated navigation capability check.
func GetPartnerAccess(c *gin.Context) {
	partner, err := model.GetPartner(c.GetInt("id"))
	if err != nil {
		partnerError(c, err)
		return
	}
	status := ""
	if partner != nil {
		status = partner.Status
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"can_access": model.CanAccessPartnerDashboard(partner), "status": status}})
}

func RequirePartnerAccess(c *gin.Context) {
	partner, err := model.GetPartner(c.GetInt("id"))
	if err != nil {
		partnerError(c, err)
		c.Abort()
		return
	}
	if !model.CanAccessPartnerDashboard(partner) {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "code": "partner_required", "message": "此账号尚未开通合作伙伴权限"})
		return
	}
	c.Next()
}

func SubmitPartnerApplication(c *gin.Context) {
	c.JSON(http.StatusForbidden, gin.H{"success": false, "code": "partner_invite_only", "message": "合作伙伴由管理员开通，不接受在线申请"})
}

func GrantPartner(c *gin.Context) {
	var input struct {
		UserID int    `json:"user_id"`
		Note   string `json:"note"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		partnerError(c, model.ErrPartnerInvalid)
		return
	}
	partner, err := model.GrantPartner(input.UserID, c.GetInt("id"), input.Note)
	if err != nil {
		partnerError(c, err)
		return
	}
	model.RecordAuditLog(c, model.AuditLog{UserId: c.GetInt("id"), ActorRole: c.GetInt("role"), Category: model.AuditCategoryOperation, Action: "partner_grant", Success: true, Content: fmt.Sprintf("Granted partner membership to user %d", input.UserID)})
	c.JSON(http.StatusOK, gin.H{"success": true, "data": partner})
}

func GetPartnerConfig(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true, "data": model.GetPartnerConfig()})
}
func UpdatePartnerConfig(c *gin.Context) {
	var config model.PartnerConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		partnerError(c, model.ErrPartnerInvalid)
		return
	}
	if err := model.UpdatePartnerConfig(config); err != nil {
		partnerError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": model.GetPartnerConfig()})
}

func ReviewPartner(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		partnerError(c, model.ErrPartnerInvalid)
		return
	}
	var input struct {
		Status     string `json:"status"`
		ReviewNote string `json:"review_note"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		partnerError(c, model.ErrPartnerInvalid)
		return
	}
	if err := model.ReviewPartner(id, c.GetInt("id"), input.Status, input.ReviewNote); err != nil {
		partnerError(c, err)
		return
	}
	p, err := model.GetPartner(id)
	if err != nil {
		partnerError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": p})
}

func UpdatePartnerCommission(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		partnerError(c, model.ErrPartnerInvalid)
		return
	}
	// An explicit null restores the global rate; omission is not an update.
	var input map[string]*int
	if err := c.ShouldBindJSON(&input); err != nil {
		partnerError(c, model.ErrPartnerInvalid)
		return
	}
	partner, err := model.UpdatePartnerCommission(id, input)
	if err != nil {
		partnerError(c, err)
		return
	}
	// Serialize validated fields only; omitted terms are left unchanged.
	changes, _ := common.Marshal(input)
	model.RecordAuditLog(c, model.AuditLog{UserId: c.GetInt("id"), ActorRole: c.GetInt("role"), Category: model.AuditCategoryOperation, Action: "partner_commission_update", Success: true, Content: fmt.Sprintf("Partner %d commission settings: %s", id, changes)})
	c.JSON(http.StatusOK, gin.H{"success": true, "data": partner})
}

func CreatePartnerPayout(c *gin.Context) {
	var input model.PartnerPayoutInput
	if err := c.ShouldBindJSON(&input); err != nil {
		partnerError(c, model.ErrPartnerInvalid)
		return
	}
	p, err := model.CreatePartnerPayout(c.GetInt("id"), input)
	if err != nil {
		partnerError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": p})
}
func ReviewPartnerPayout(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		partnerError(c, model.ErrPartnerInvalid)
		return
	}
	var input struct {
		Status     string `json:"status"`
		ReviewNote string `json:"review_note"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		partnerError(c, model.ErrPartnerInvalid)
		return
	}
	if err := model.ReviewPartnerPayout(id, c.GetInt("id"), input.Status, input.ReviewNote); err != nil {
		partnerError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// PartnerList is shared only by the explicitly registered user/admin handlers;
// a caller-controlled query parameter never chooses the authorization scope.
func partnerList(c *gin.Context, kind string, admin bool) {
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 || page > 1000000 {
		partnerError(c, model.ErrPartnerInvalid)
		return
	}
	size := 20
	if admin {
		size, err = strconv.Atoi(c.DefaultQuery("size", "20"))
		if err != nil || size < 1 || size > 100 {
			partnerError(c, model.ErrPartnerInvalid)
			return
		}
	}
	var items any
	var query *gorm.DB
	switch kind {
	case "partners":
		items = &[]model.Partner{}
		query = model.DB.Model(&model.Partner{}).Where("status IN ? AND approved_at > 0", []string{"approved", "suspended"})
	case "commissions":
		items = &[]model.PartnerCommission{}
		query = model.DB.Model(&model.PartnerCommission{})
	case "payouts":
		items = &[]model.PartnerPayout{}
		query = model.DB.Model(&model.PartnerPayout{})
	}
	if !admin {
		col := "user_id"
		if kind == "commissions" {
			col = "partner_id"
		}
		query = query.Where(col+" = ?", c.GetInt("id"))
	} else {
		if id := c.Query("user_id"); id != "" {
			n, e := strconv.Atoi(id)
			if e != nil || n <= 0 {
				partnerError(c, model.ErrPartnerInvalid)
				return
			}
			col := "user_id"
			if kind == "commissions" {
				col = "partner_id"
			}
			query = query.Where(col+" = ?", n)
		}
		if status := c.Query("status"); status != "" && kind != "commissions" {
			query = query.Where("status = ?", status)
		}
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		partnerError(c, err)
		return
	}
	order := "id DESC"
	if kind == "partners" {
		order = "updated_at DESC, user_id DESC"
	}
	if err := query.Order(order).Limit(size).Offset((page - 1) * size).Find(items).Error; err != nil {
		partnerError(c, err)
		return
	}
	if kind == "partners" {
		partners := *items.(*[]model.Partner)
		ids := make([]int, 0, len(partners))
		for _, partner := range partners {
			ids = append(ids, partner.UserID)
		}
		var users []model.User
		if len(ids) > 0 {
			if err := model.DB.Select("id", "username").Where("id IN ?", ids).Find(&users).Error; err != nil {
				partnerError(c, err)
				return
			}
		}
		usernames := make(map[int]string, len(users))
		for _, user := range users {
			usernames[user.Id] = user.Username
		}
		type partnerListItem struct {
			model.Partner
			Username string `json:"username"`
		}
		rows := make([]partnerListItem, 0, len(partners))
		for _, partner := range partners {
			rows = append(rows, partnerListItem{Partner: partner, Username: usernames[partner.UserID]})
		}
		items = rows
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": items, "total": total, "page": page}})
}
func ListPartners(c *gin.Context)                { partnerList(c, "partners", true) }
func ListPartnerCommissions(c *gin.Context)      { partnerList(c, "commissions", false) }
func ListAdminPartnerCommissions(c *gin.Context) { partnerList(c, "commissions", true) }
func ListPartnerPayouts(c *gin.Context)          { partnerList(c, "payouts", false) }
func ListAdminPartnerPayouts(c *gin.Context)     { partnerList(c, "payouts", true) }

func ListPartnerInvitees(c *gin.Context) {
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 || page > 1000000 {
		partnerError(c, model.ErrPartnerInvalid)
		return
	}
	type invitee struct {
		UserID          int    `json:"user_id"`
		Username        string `json:"username"`
		CreatedAt       int64  `json:"created_at"`
		TopupCount      int64  `json:"topup_count"`
		TopupQuota      int64  `json:"topup_quota"`
		CommissionQuota int64  `json:"commission_quota"`
	}
	items := []invitee{}
	query := model.DB.Model(&model.User{}).Where("inviter_id = ?", c.GetInt("id"))
	var total int64
	if err := query.Count(&total).Error; err != nil {
		partnerError(c, err)
		return
	}
	if err := query.Select("id AS user_id, username, created_at").Order("id DESC").Limit(20).Offset((page - 1) * 20).Scan(&items).Error; err != nil {
		partnerError(c, err)
		return
	}
	ids := make([]int, 0, len(items))
	for _, row := range items {
		ids = append(ids, row.UserID)
	}
	if len(ids) > 0 {
		var sums []invitee
		if err := model.DB.Model(&model.PartnerCommission{}).Select("user_id, COUNT(*) AS topup_count, COALESCE(SUM(top_up_quota),0) AS topup_quota, COALESCE(SUM(commission_quota),0) AS commission_quota").Where("partner_id = ? AND user_id IN ?", c.GetInt("id"), ids).Group("user_id").Scan(&sums).Error; err != nil {
			partnerError(c, err)
			return
		}
		byID := make(map[int]invitee, len(sums))
		for _, row := range sums {
			byID[row.UserID] = row
		}
		for i := range items {
			v := byID[items[i].UserID]
			items[i].TopupCount = v.TopupCount
			items[i].TopupQuota = v.TopupQuota
			items[i].CommissionQuota = v.CommissionQuota
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": items, "total": total, "page": page}})
}
