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
import { z } from 'zod'

export const partnerConfigSchema = z.object({
  balance_price_source: z.literal('alipay_native'),
  enabled: z.boolean(),
  commission_bps: z.number().int().min(0).max(10000),
  duration_days: z.number().int().min(0).max(36500),
  first_topup_only: z.literal(false),
  min_payout_cents: z.number().int().min(1).max(1e12),
  alipay_daily_limit_cents: z.number().int().min(0).max(1e12),
  bank_single_limit_cents: z.number().int().min(0).max(1e12),
})
