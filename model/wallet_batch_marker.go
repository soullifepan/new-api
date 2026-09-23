package model

import (
	"errors"
	"fmt"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// WalletBatchMarker blocks transfers while a process buffers wallet changes.
// An orphaned marker deliberately requires reconciliation before funds move.
type WalletBatchMarker struct {
	UserID     int    `gorm:"primaryKey"`
	InstanceID string `gorm:"primaryKey;type:varchar(64)"`
}

var walletBatchInstanceID = common.GetRandomString(32)
var walletBatchUserLocks [256]sync.Mutex

// A transaction error can mean COMMIT succeeded but its acknowledgement was
// lost. Never enqueue another delta for that user until an operator reconciles
// the local queue with the database. The process must keep running for other
// users, so this is tracked per account.
var walletBatchUncertain sync.Map

func walletBatchUserLock(id int) *sync.Mutex {
	return &walletBatchUserLocks[uint(id)%uint(len(walletBatchUserLocks))]
}

func queueWalletQuotaDelta(id, delta int) error {
	lock := walletBatchUserLock(id)
	lock.Lock()
	defer lock.Unlock()
	if err := ensureWalletBatchMarker(id); err != nil {
		return err
	}
	addNewRecord(BatchUpdateTypeUserQuota, id, delta)
	if common.RedisEnabled {
		if _, err := cacheApplyUserQuotaDelta(id, int64(delta)); err != nil {
			common.SysLog("failed to update wallet quota cache: " + err.Error())
		}
	}
	return nil
}

func flushWalletBatch() {
	batchUpdateLocks[BatchUpdateTypeUserQuota].Lock()
	ids := make([]int, 0, len(batchUpdateStores[BatchUpdateTypeUserQuota]))
	for id := range batchUpdateStores[BatchUpdateTypeUserQuota] {
		ids = append(ids, id)
	}
	batchUpdateLocks[BatchUpdateTypeUserQuota].Unlock()

	for _, id := range ids {
		lock := walletBatchUserLock(id)
		lock.Lock()
		if _, uncertain := walletBatchUncertain.Load(id); uncertain {
			lock.Unlock()
			continue
		}
		batchUpdateLocks[BatchUpdateTypeUserQuota].Lock()
		delta, exists := batchUpdateStores[BatchUpdateTypeUserQuota][id]
		batchUpdateLocks[BatchUpdateTypeUserQuota].Unlock()
		if !exists {
			lock.Unlock()
			continue
		}
		err := DB.Transaction(func(tx *gorm.DB) error {
			if delta != 0 {
				result := tx.Model(&User{}).Where("id = ?", id).UpdateColumn("quota", gorm.Expr("quota + ?", delta))
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected != 1 {
					return gorm.ErrRecordNotFound
				}
			}
			result := tx.Where("user_id = ? AND instance_id = ?", id, walletBatchInstanceID).Delete(&WalletBatchMarker{})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return gorm.ErrRecordNotFound
			}
			return nil
		})
		if err != nil {
			// COMMIT may have succeeded without an acknowledgement. Retrying
			// could apply the delta twice, so freeze this account for review.
			walletBatchUncertain.Store(id, struct{}{})
			common.SysError(fmt.Sprintf("wallet batch outcome is uncertain for user %d; manual reconciliation required: %v", id, err))
		} else {
			batchUpdateLocks[BatchUpdateTypeUserQuota].Lock()
			delete(batchUpdateStores[BatchUpdateTypeUserQuota], id)
			batchUpdateLocks[BatchUpdateTypeUserQuota].Unlock()
		}
		lock.Unlock()
	}
}

// getWalletUserCache holds the user row while rebuilding an expired Redis
// balance, so a transfer cannot commit between the DB read and cache write.
func getWalletUserCache(userID int) (*UserBase, error) {
	lock := walletBatchUserLock(userID)
	lock.Lock()
	defer lock.Unlock()

	var user User
	err := DB.Transaction(func(tx *gorm.DB) error {
		if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
			if err := tx.Model(&User{}).Where("id = ?", userID).
				UpdateColumn("quota", gorm.Expr("quota")).Error; err != nil {
				return err
			}
		}
		if err := lockForUpdate(tx).Omit("password", "access_token").First(&user, userID).Error; err != nil {
			return err
		}
		var markers []WalletBatchMarker
		if err := lockForUpdate(tx).Where("user_id = ?", userID).Find(&markers).Error; err != nil {
			return err
		}
		if len(markers) != 0 {
			batchUpdateLocks[BatchUpdateTypeUserQuota].Lock()
			delta, queued := batchUpdateStores[BatchUpdateTypeUserQuota][userID]
			batchUpdateLocks[BatchUpdateTypeUserQuota].Unlock()
			if len(markers) != 1 || markers[0].InstanceID != walletBatchInstanceID || !queued ||
				user.Quota < 0 || user.Quota > common.MaxWalletQuota ||
				delta < -common.MaxWalletQuota || delta > common.MaxWalletQuota {
				return ErrWalletQuotaPending
			}
			user.Quota += delta
			if user.Quota < 0 || user.Quota > common.MaxWalletQuota {
				return ErrWalletQuotaPending
			}
		}
		floor, floorErr := getUserAuthVersionFloor(userID)
		if floorErr == nil && floor > user.AuthVersion {
			return ErrUserAuthCachePending
		}
		if err := populateUserCache(user); err != nil {
			if errors.Is(err, ErrUserAuthCachePending) {
				return err
			}
			common.SysLog("failed to synchronously populate user cache: " + err.Error())
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return user.ToBaseUser(), nil
}

// The caller holds the user's striped lock until its cache mutation and batch
// enqueue complete. The database marker is the cross-instance transfer fence.
func ensureWalletBatchMarker(id int) error {
	if _, uncertain := walletBatchUncertain.Load(id); uncertain {
		return ErrWalletTransferUnavailable
	}
	batchUpdateLocks[BatchUpdateTypeUserQuota].Lock()
	_, exists := batchUpdateStores[BatchUpdateTypeUserQuota][id]
	batchUpdateLocks[BatchUpdateTypeUserQuota].Unlock()
	if exists {
		return nil
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").First(&user, id).Error; err != nil {
			return err
		}
		if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
			if err := tx.Model(&User{}).Where("id = ?", id).UpdateColumn("quota", gorm.Expr("quota")).Error; err != nil {
				return err
			}
		}
		var existing []WalletBatchMarker
		if err := tx.Where("user_id = ? AND instance_id = ?", id, walletBatchInstanceID).
			Limit(1).Find(&existing).Error; err != nil {
			return err
		}
		if len(existing) != 0 {
			// An old marker can only be left by an incomplete batch. Never reuse it.
			return ErrWalletTransferUnavailable
		}
		return tx.Create(&WalletBatchMarker{UserID: id, InstanceID: walletBatchInstanceID}).Error
	})
	if err != nil {
		return err
	}
	batchUpdateLocks[BatchUpdateTypeUserQuota].Lock()
	batchUpdateStores[BatchUpdateTypeUserQuota][id] = 0
	batchUpdateLocks[BatchUpdateTypeUserQuota].Unlock()
	return nil
}
