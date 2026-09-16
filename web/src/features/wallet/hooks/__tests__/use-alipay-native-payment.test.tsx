import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  getAlipayNativeOrder,
  isApiSuccess,
  requestAlipayNativePayment,
} from '../../api'
import { useAlipayNativePayment } from '../use-alipay-native-payment'

vi.mock('../../api', () => ({
  calculateAlipayNativeAmount: vi.fn(),
  getAlipayNativeOrder: vi.fn(),
  isApiSuccess: vi.fn(() => true),
  requestAlipayNativePayment: vi.fn(),
}))
vi.mock('@/lib/handle-server-error', () => ({ handleServerError: vi.fn() }))

const payment = {
  trade_no: 'trade-1',
  qr_code: 'https://example.test/qr',
  amount: '12.00',
  currency: 'CNY' as const,
  sandbox: true,
}

describe('useAlipayNativePayment', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    vi.mocked(isApiSuccess).mockReturnValue(true)
    vi.mocked(requestAlipayNativePayment).mockResolvedValue({
      success: true,
      data: payment,
    })
    vi.mocked(getAlipayNativeOrder).mockResolvedValue({
      success: true,
      data: { trade_no: payment.trade_no, status: 'pending' },
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  test('连续点击下单时只创建一个订单', async () => {
    let resolvePayment: (value: {
      success: boolean
      data: typeof payment
    }) => void = () => undefined
    vi.mocked(requestAlipayNativePayment).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePayment = resolve
        })
    )
    const { result } = renderHook(() => useAlipayNativePayment(vi.fn()))
    let first: Promise<boolean> | undefined
    let second: Promise<boolean> | undefined
    act(() => {
      first = result.current.start(12)
      second = result.current.start(12)
    })
    expect(requestAlipayNativePayment).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolvePayment({ success: true, data: payment })
      await first
      await second
    })
    expect(result.current.payment?.trade_no).toBe(payment.trade_no)
  })

  test('关闭弹窗后不再轮询订单', async () => {
    const { result } = renderHook(() => useAlipayNativePayment(vi.fn()))
    await act(async () => {
      await result.current.start(12)
    })
    await act(async () => {})
    expect(getAlipayNativeOrder).toHaveBeenCalledTimes(1)
    act(() => result.current.close())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(getAlipayNativeOrder).toHaveBeenCalledTimes(1)
  })

  test('支付成功时只刷新一次且卸载后不更新', async () => {
    const onSuccess = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getAlipayNativeOrder).mockResolvedValueOnce({
      success: true,
      data: { trade_no: payment.trade_no, status: 'success' },
    })
    const { result, unmount } = renderHook(() =>
      useAlipayNativePayment(onSuccess)
    )
    await act(async () => {
      await result.current.start(12)
    })
    await act(async () => {})
    expect(onSuccess).toHaveBeenCalledTimes(1)
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  test('查单异常后卸载时不会安排残留轮询或更新状态', async () => {
    vi.mocked(getAlipayNativeOrder).mockRejectedValueOnce(
      new Error('network unavailable')
    )
    const { result, unmount } = renderHook(() =>
      useAlipayNativePayment(vi.fn())
    )
    await act(async () => {
      await result.current.start(12)
    })
    await act(async () => {})
    expect(result.current.payment?.trade_no).toBe(payment.trade_no)
    expect(getAlipayNativeOrder).toHaveBeenCalledTimes(1)

    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(getAlipayNativeOrder).toHaveBeenCalledTimes(1)
  })

  test('预下单结果未知时保留订单号查询而不允许重复下单', async () => {
    vi.mocked(requestAlipayNativePayment).mockResolvedValueOnce({
      message: 'error',
      data: '创建支付订单失败，请稍后查询订单状态',
      trade_no: 'trade-unknown',
    })
    const { result } = renderHook(() => useAlipayNativePayment(vi.fn()))
    await act(async () => {
      await result.current.start(12)
    })
    expect(result.current.payment).toEqual({ trade_no: 'trade-unknown' })
    expect(requestAlipayNativePayment).toHaveBeenCalledTimes(1)
  })

  test('查单失败或过期时停止自动轮询并显示终态', async () => {
    vi.mocked(getAlipayNativeOrder).mockResolvedValueOnce({
      success: true,
      data: { trade_no: payment.trade_no, status: 'expired' },
    })
    const { result } = renderHook(() => useAlipayNativePayment(vi.fn()))
    await act(async () => {
      await result.current.start(12)
    })
    await act(async () => {})
    expect(result.current.status).toBe('expired')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(getAlipayNativeOrder).toHaveBeenCalledTimes(1)
  })

  test('待支付状态持续轮询直到支付成功后只刷新一次', async () => {
    const onSuccess = vi.fn().mockResolvedValue(undefined)
    vi.mocked(getAlipayNativeOrder)
      .mockResolvedValueOnce({
        success: true,
        data: { trade_no: payment.trade_no, status: 'pending' },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { trade_no: payment.trade_no, status: 'pending' },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { trade_no: payment.trade_no, status: 'success' },
      })
    const { result } = renderHook(() => useAlipayNativePayment(onSuccess))
    await act(async () => {
      await result.current.start(12)
    })
    await act(async () => {})
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(getAlipayNativeOrder).toHaveBeenCalledTimes(3)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(result.current.payment).toBeNull()
  })

  test('查单网络错误显示可重试状态且重试后恢复查询', async () => {
    vi.mocked(getAlipayNativeOrder)
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({
        success: true,
        data: { trade_no: payment.trade_no, status: 'pending' },
      })
    const { result } = renderHook(() => useAlipayNativePayment(vi.fn()))
    await act(async () => {
      await result.current.start(12)
    })
    await act(async () => {})
    expect(result.current.status).toBe('network-error')
    act(() => result.current.retry())
    await act(async () => {})
    expect(getAlipayNativeOrder).toHaveBeenCalledTimes(2)
  })
})
