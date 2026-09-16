import { describe, expect, test } from 'vitest'

import { getAlipayNativeMinimum } from '../alipay-native'

describe('getAlipayNativeMinimum', () => {
  test('returns the configured minimum only when native Alipay is enabled', () => {
    expect(
      getAlipayNativeMinimum({
        enable_alipay_native: true,
        alipay_native_min_topup: 20,
      })
    ).toBe(20)
    expect(getAlipayNativeMinimum({ enable_alipay_native: false })).toBeNull()
    expect(getAlipayNativeMinimum({ enable_alipay_native: true })).toBeNull()
  })
})
