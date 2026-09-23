package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// WalletTransferReserveQuota keeps 20 USD of wallet quota regardless of the
// currency used to display balances.
func WalletTransferReserveQuota() (int, error) {
	if common.QuotaPerUnit <= 0 {
		return 0, ErrWalletTransferUnavailable
	}
	amount := decimal.NewFromInt(20).Mul(decimal.NewFromInt(int64(common.QuotaPerUnit)))
	return common.WalletQuotaFromDecimalStrict(amount)
}

func GetTransferableWalletQuota(userID int) (int, error) {
	reserve, err := WalletTransferReserveQuota()
	if err != nil {
		return 0, err
	}
	var pending int64
	if err := DB.Model(&WalletBatchMarker{}).Where("user_id = ?", userID).Count(&pending).Error; err != nil {
		return 0, err
	}
	if pending != 0 {
		return 0, nil
	}
	quota, err := GetUserQuota(userID, false)
	if err != nil {
		return 0, err
	}
	dbQuota, err := GetUserQuota(userID, true)
	if err != nil {
		return 0, err
	}
	return max(0, min(quota, dbQuota)-reserve), nil
}

var (
	ErrWalletTransferInvalid      = errors.New("invalid wallet transfer")
	ErrWalletTransferInsufficient = errors.New("insufficient wallet balance")
	ErrWalletTransferUnavailable  = errors.New("wallet transfer temporarily unavailable")
	ErrWalletTransferRecipient    = errors.New("wallet transfer recipient is unavailable")
	ErrWalletTransferPermission   = errors.New("wallet transfer is not permitted")
)

// WalletTransfer records a committed movement of wallet quota between users.
// SourceUserID and RequestID make client retries idempotent.
type WalletTransfer struct {
	ID             int    `json:"id"`
	SourceUserID   int    `json:"source_user_id" gorm:"not null;uniqueIndex:idx_wallet_transfer_request"`
	TargetUserID   int    `json:"target_user_id" gorm:"not null;index"`
	SourceUsername string `json:"source_username" gorm:"type:varchar(20);not null"`
	TargetUsername string `json:"target_username" gorm:"type:varchar(20);not null"`
	ActorUserID    int    `json:"actor_user_id" gorm:"not null;index"`
	Quota          int    `json:"quota" gorm:"not null"`
	RequestID      string `json:"request_id" gorm:"type:varchar(64);not null;uniqueIndex:idx_wallet_transfer_request"`
	CreatedAt      int64  `json:"created_at" gorm:"autoCreateTime"`
}

func ListWalletTransfers(userID int, limit, offset int) ([]WalletTransfer, int64, error) {
	query := DB.Model(&WalletTransfer{}).Where("source_user_id = ? OR target_user_id = ? OR actor_user_id = ?", userID, userID, userID)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var transfers []WalletTransfer
	err := query.Order("id desc").Limit(limit).Offset(offset).Find(&transfers).Error
	return transfers, total, err
}

// TransferWalletQuota atomically moves settled wallet balances and inserts a
// history row. In batch mode, durable markers exclude accounts whose wallet
// deltas have not reached the database.
func TransferWalletQuota(sourceID, targetID, actorID, actorRole, quota int, requestID string) (*WalletTransfer, error) {
	requestID = strings.TrimSpace(requestID)
	if sourceID <= 0 || targetID <= 0 || actorID <= 0 || sourceID == targetID ||
		quota <= 0 || quota > common.MaxWalletQuota || len(requestID) < 8 || len(requestID) > 64 {
		return nil, ErrWalletTransferInvalid
	}
	if sourceID != actorID && actorRole < common.RoleAdminUser {
		return nil, ErrWalletTransferPermission
	}
	var existing WalletTransfer
	err := DB.Where("source_user_id = ? AND request_id = ?", sourceID, requestID).First(&existing).Error
	if err == nil {
		if existing.TargetUserID != targetID || existing.Quota != quota || existing.ActorUserID != actorID {
			return nil, ErrWalletTransferInvalid
		}
		return &existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	reserve, err := WalletTransferReserveQuota()
	if err != nil {
		return nil, err
	}
	if quota > common.MaxWalletQuota-reserve {
		return nil, ErrWalletTransferInvalid
	}
	cacheReserved := false
	if common.RedisEnabled {
		result, cacheErr := cacheTryReserveUserQuota(sourceID, int64(quota), int64(reserve))
		if cacheErr == nil && result == cacheQuotaMiss {
			if _, hydrateErr := GetUserCache(sourceID); hydrateErr == nil {
				result, cacheErr = cacheTryReserveUserQuota(sourceID, int64(quota), int64(reserve))
			}
		}
		if cacheErr != nil || result == cacheQuotaMiss {
			return nil, ErrWalletTransferUnavailable
		}
		if result == cacheQuotaInsufficient {
			return nil, ErrWalletTransferInsufficient
		}
		cacheReserved = true
	}
	committed := false
	defer func() {
		if cacheReserved && !committed {
			result, err := cacheApplyUserQuotaDelta(sourceID, int64(quota))
			if err != nil || result != cacheQuotaOK {
				common.SysError(fmt.Sprintf("failed to restore wallet transfer reservation for user %d: result=%d error=%v", sourceID, result, err))
			}
		}
	}()

	var transfer WalletTransfer
	created := false
	err = DB.Transaction(func(tx *gorm.DB) error {
		var users []User
		if err := lockForUpdate(tx).Where("id IN ?", []int{sourceID, targetID}).Order("id").Find(&users).Error; err != nil {
			return err
		}
		if len(users) != 2 {
			return ErrWalletTransferRecipient
		}
		var source, target *User
		for i := range users {
			user := &users[i]
			if user.Status != common.UserStatusEnabled {
				return ErrWalletTransferRecipient
			}
			if user.Id == sourceID {
				source = user
			} else {
				target = user
			}
		}
		if source == nil || target == nil {
			return ErrWalletTransferRecipient
		}
		var prior WalletTransfer
		findErr := lockForUpdate(tx).Where("source_user_id = ? AND request_id = ?", sourceID, requestID).First(&prior).Error
		if findErr == nil {
			if prior.TargetUserID != targetID || prior.Quota != quota || prior.ActorUserID != actorID {
				return ErrWalletTransferInvalid
			}
			transfer = prior
			return nil
		}
		if !errors.Is(findErr, gorm.ErrRecordNotFound) {
			return findErr
		}
		// Durable markers must be honored even when this instance has batch
		// updates disabled. Another instance (or its predecessor) may still
		// have unflushed wallet changes for either account.
		// SQLite has no SELECT FOR UPDATE; acquire its write lock first.
		if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
			result := tx.Model(&User{}).Where("id IN ?", []int{sourceID, targetID}).
				UpdateColumn("quota", gorm.Expr("quota"))
			if result.Error != nil {
				return result.Error
			}
		}
		var pending []WalletBatchMarker
		if err := lockForUpdate(tx).Where("user_id IN ?", []int{sourceID, targetID}).Find(&pending).Error; err != nil {
			return err
		}
		if len(pending) != 0 {
			return ErrWalletTransferUnavailable
		}
		if sourceID != actorID && actorRole != common.RoleRootUser && actorRole <= source.Role {
			return ErrWalletTransferPermission
		}
		debit := tx.Model(&User{}).Where("id = ? AND quota >= ?", sourceID, quota+reserve).
			Update("quota", gorm.Expr("quota - ?", quota))
		if debit.Error != nil {
			return debit.Error
		}
		if debit.RowsAffected != 1 {
			return ErrWalletTransferInsufficient
		}
		credit := tx.Model(&User{}).Where("id = ? AND quota <= ?", targetID, common.MaxWalletQuota-quota).
			Update("quota", gorm.Expr("quota + ?", quota))
		if credit.Error != nil {
			return credit.Error
		}
		if credit.RowsAffected != 1 {
			return ErrWalletQuotaLimitExceeded
		}
		transfer = WalletTransfer{
			SourceUserID: sourceID, TargetUserID: targetID,
			SourceUsername: source.Username, TargetUsername: target.Username,
			ActorUserID: actorID, Quota: quota, RequestID: requestID,
		}
		if err := tx.Create(&transfer).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil {
		if !created {
			return nil, err
		}
		// A failed COMMIT acknowledgement does not prove the transaction rolled
		// back. Keep the cache debit unless the ledger proves it did not commit.
		var persisted WalletTransfer
		lookupErr := DB.Where("source_user_id = ? AND request_id = ?", sourceID, requestID).First(&persisted).Error
		if lookupErr == nil {
			if persisted.TargetUserID != targetID || persisted.Quota != quota || persisted.ActorUserID != actorID {
				committed = true
				return nil, ErrWalletTransferUnavailable
			}
			transfer = persisted
		} else if errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			return nil, err
		} else {
			committed = true
			return nil, ErrWalletTransferUnavailable
		}
	}
	if !created {
		return &transfer, nil
	}
	committed = true
	if common.RedisEnabled {
		if err := cacheIncrUserQuota(targetID, int64(quota)); err != nil {
			common.SysLog(fmt.Sprintf("failed to credit wallet transfer cache for user %d: %v", targetID, err))
			if err := invalidateUserCache(targetID); err != nil {
				common.SysLog(fmt.Sprintf("failed to invalidate wallet transfer cache for user %d: %v", targetID, err))
			}
		}
	}
	return &transfer, nil
}
