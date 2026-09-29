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
import { requireServerSuccess } from '@/lib/server-error-message'

export type PartnerConfig = {
  balance_price_source: 'alipay_native'
  enabled: boolean
  commission_bps: number
  duration_days: number
  first_topup_only: false
  min_payout_cents: number
  alipay_daily_limit_cents: number
  bank_single_limit_cents: number
}
export type Partner = {
  commission_bps: number | null
  user_id: number
  status: string
  channels: string
  links: string
  plan: string
  contact: string
  evidence: string
  notes: string
  review_note: string
  available_quota: number
  earned_quota: number
  reserved_quota: number
  approved_at: number
  updated_at: number
}
export type Payout = {
  id: number
  user_id: number
  kind: string
  amount: string
  currency: string
  status: string
  recipient_name: string
  account: string
  bank_name: string
  company_code: string
  debit_quota: number
  quota: number
  exchange_rate: string
  credit_price: string
  created_at: number
  completed_at: number
  reviewed_by: number
  review_note: string
}
export type Commission = {
  reason: string
  id: number
  partner_id: number
  user_id: number
  topup_id: number
  paid_amount: string
  paid_currency: string
  exchange_rate: string
  topup_quota: number
  commission_quota: number
  commission_bps: number
  created_at: number
}
export type Page<T> = { items: T[]; total: number; page: number }
const base = '/api/tapcomfy/v1/admin/partners'
export async function getPartnerConfig() {
  return requireServerSuccess(
    (await api.get<{ success: boolean; data: PartnerConfig }>(`${base}/config`))
      .data
  ).data
}
export async function savePartnerConfig(config: PartnerConfig) {
  return requireServerSuccess((await api.put(`${base}/config`, config)).data)
}
export async function listPartners(page: number, status: string, size = 20) {
  return requireServerSuccess(
    (
      await api.get<{ success: boolean; data: Page<Partner> }>(base, {
        params: { page, status, size },
      })
    ).data
  ).data
}
export async function listPayouts(page: number, status: string, size = 20) {
  return requireServerSuccess(
    (
      await api.get<{ success: boolean; data: Page<Payout> }>(
        `${base}/payouts`,
        { params: { page, status, size } }
      )
    ).data
  ).data
}
export async function listCommissions(page: number, size = 20) {
  return requireServerSuccess(
    (
      await api.get<{ success: boolean; data: Page<Commission> }>(
        `${base}/commissions`,
        { params: { page, size } }
      )
    ).data
  ).data
}
export async function reviewPartner(
  id: number,
  status: string,
  review_note: string
) {
  return requireServerSuccess(
    (await api.put(`${base}/${id}`, { status, review_note })).data
  )
}
export async function reviewPayout(
  id: number,
  status: string,
  review_note: string
) {
  return requireServerSuccess(
    (await api.put(`${base}/payouts/${id}`, { status, review_note })).data
  )
}

export async function updatePartnerCommission(
  id: number,
  commission_bps: number | null
) {
  return requireServerSuccess(
    (
      await api.put<{ success: boolean; data: Partner }>(
        `${base}/${id}/commission`,
        { commission_bps }
      )
    ).data
  ).data
}
