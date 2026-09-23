/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { api } from '@/lib/api'
import { createServerError } from '@/lib/server-error-message'

export type WalletTransfer = {
  id: number
  source_user_id: number
  target_user_id: number
  source_username: string
  target_username: string
  actor_user_id: number
  quota: number
  request_id: string
  created_at: number
}

export type WalletTransferSummary = {
  quota: number
  transferable_quota: number
  reserve_quota: number
  quota_per_unit: number
  currency: 'USD' | 'CNY' | 'TOKENS' | 'CUSTOM'
  currency_symbol: string
  exchange_rate: string
  transfer_enabled: boolean
}

export type WalletTransferPage = {
  items: WalletTransfer[]
  total: number
  page: number
}

export type WalletTransferRequest = {
  recipient: string
  amount: string
  currency: WalletTransferSummary['currency']
  exchange_rate: string
  request_id: string
  source_username?: string
}

type ApiResponse<T> = {
  success: boolean
  data: T
  message?: string
}

export async function getWalletTransferSummary(): Promise<WalletTransferSummary> {
  const response = await api.get<ApiResponse<WalletTransferSummary>>(
    '/api/tapcomfy/v1/wallet'
  )
  if (!response.data.success) {
    throw createServerError(response.data, 'Unable to load wallet balance')
  }
  return response.data.data
}

export async function getWalletTransfers(
  page: number
): Promise<WalletTransferPage> {
  const response = await api.get<ApiResponse<WalletTransferPage>>(
    '/api/tapcomfy/v1/wallet/transfers',
    { params: { page } }
  )
  if (!response.data.success) {
    throw createServerError(response.data, 'Unable to load transfers')
  }
  return response.data.data
}

export async function createWalletTransfer(
  request: WalletTransferRequest,
  admin: boolean
): Promise<WalletTransfer> {
  const path = admin
    ? '/api/tapcomfy/v1/admin/wallet/transfers'
    : '/api/tapcomfy/v1/wallet/transfers'
  const response = await api.post<ApiResponse<WalletTransfer>>(path, request)
  if (!response.data.success) {
    throw createServerError(response.data, 'Unable to transfer balance')
  }
  return response.data.data
}
