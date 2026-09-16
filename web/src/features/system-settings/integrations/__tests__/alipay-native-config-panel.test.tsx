import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { AlipayNativeConfigPanel } from '../alipay-native-config-panel'

const { get, post } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: { get, post } }))
vi.mock('@/lib/handle-server-error', () => ({ handleServerError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

const serverConfig = {
  AlipayNativeEnabled: true,
  AlipayNativeSandbox: true,
  AlipayNativeAppID: 'sandbox-app',
  AlipayNativeSellerID: 'seller-1',
  AlipayNativePublicKey: 'public-key',
  AlipayNativeAppCert: '',
  AlipayNativeAlipayCert: '',
  AlipayNativeRootCert: '',
  AlipayNativeUnitPrice: 1.5,
  AlipayNativeMinTopUp: 10,
  AlipayNativePrivateKeyConfigured: true,
}

describe('AlipayNativeConfigPanel', () => {
  beforeEach(() => {
    get.mockReset()
    post.mockReset()
    get.mockResolvedValue({ data: { success: true, data: serverConfig } })
    post.mockResolvedValue({ data: { success: true } })
  })

  test('使用模拟接口读取配置并以完整前缀字段保存', async () => {
    const user = userEvent.setup()
    render(<AlipayNativeConfigPanel />)

    await screen.findByDisplayValue('sandbox-app')
    expect(screen.getByLabelText('支付宝公钥')).toHaveValue('public-key')
    expect(screen.getByLabelText('应用私钥')).toHaveValue('')

    await user.clear(screen.getByLabelText('应用 APPID'))
    await user.type(screen.getByLabelText('应用 APPID'), 'updated-app')
    await user.click(
      screen.getByRole('button', { name: '保存支付宝当面付设置' })
    )

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        '/api/option/alipay-native/config',
        expect.objectContaining({
          AlipayNativeAppID: 'updated-app',
          AlipayNativePrivateKey: '',
          AlipayNativePublicKey: 'public-key',
          AlipayNativeMinTopUp: 10,
        })
      )
    })
  })

  test('读取失败时禁止保存并允许重试', async () => {
    get.mockRejectedValueOnce(new Error('request failed'))
    const user = userEvent.setup()
    render(<AlipayNativeConfigPanel />)

    await screen.findByText('配置加载失败')
    expect(
      screen.getByRole('button', { name: '保存支付宝当面付设置' })
    ).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => {
      expect(get).toHaveBeenCalledTimes(2)
    })
    expect(
      screen.getByRole('button', { name: '保存支付宝当面付设置' })
    ).toBeEnabled()
  })

  test('切换证书模式时清理互斥的公钥字段', async () => {
    const user = userEvent.setup()
    render(<AlipayNativeConfigPanel />)

    await screen.findByLabelText('支付宝公钥')
    await user.click(screen.getByRole('button', { name: '证书' }))
    expect(screen.queryByLabelText('支付宝公钥')).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: '保存支付宝当面付设置' })
    )
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        '/api/option/alipay-native/config',
        expect.objectContaining({
          AlipayNativePublicKey: '',
          AlipayNativeAppCert: '',
          AlipayNativeAlipayCert: '',
          AlipayNativeRootCert: '',
        })
      )
    })
  })
})
