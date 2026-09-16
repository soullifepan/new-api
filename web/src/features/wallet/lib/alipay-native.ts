import type { TopupInfo } from '../types'

export function getAlipayNativeMinimum(
  topupInfo: Pick<TopupInfo, 'enable_alipay_native' | 'alipay_native_min_topup'>
): number | null {
  if (!topupInfo.enable_alipay_native) return null
  const minTopup = topupInfo.alipay_native_min_topup
  return typeof minTopup === 'number' && minTopup > 0 ? minTopup : null
}
