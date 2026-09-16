import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { AlipayNativePaymentDialog } from '../alipay-native-payment-dialog'

vi.mock('qrcode.react', () => ({
  QRCodeSVG: (props: { value: string }) => <div data-qr-code={props.value} />,
}))

describe('AlipayNativePaymentDialog', () => {
  test('展示模拟支付接口返回的二维码、金额和沙箱提示', () => {
    render(
      <AlipayNativePaymentDialog
        payment={{
          trade_no: 'AN-test-1',
          qr_code: 'https://mock.example/qr',
          amount: '12.50',
          currency: 'CNY',
          sandbox: true,
        }}
        status='pending'
        onRetry={vi.fn()}
        onOpenChange={vi.fn()}
      />
    )

    expect(screen.getByText('Scan with Alipay to pay')).toBeVisible()
    expect(screen.getByText('This is a sandbox payment. No real funds will be charged.')).toBeVisible()
    expect(screen.getByText('AN-test-1')).toBeVisible()
    expect(screen.getByText('¥12.50 CNY')).toBeVisible()
    expect(document.querySelector('[data-qr-code="https://mock.example/qr"]')).toBeTruthy()
  })

  test('未知预下单结果只显示订单查询提示，不渲染空二维码', () => {
    render(
      <AlipayNativePaymentDialog
        payment={{ trade_no: 'AN-unknown' }}
        status='pending'
        onRetry={vi.fn()}
        onOpenChange={vi.fn()}
      />
    )

    expect(screen.getByText('AN-unknown')).toBeVisible()
    expect(
      screen.getByText('The order is being checked. Do not submit another payment request.')
    ).toBeVisible()
    expect(document.querySelector('[data-qr-code]')).toBeNull()
  })

  test('网络异常提供重试入口且终态显示失败信息', async () => {
    const onRetry = vi.fn()
    const user = userEvent.setup()
    render(
      <AlipayNativePaymentDialog
        payment={{ trade_no: 'AN-expired' }}
        status='network-error'
        onRetry={onRetry}
        onOpenChange={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(
      screen.getAllByText('Network connection failed or server not responding')[0]
    ).toBeVisible()
  })
})
