import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'

type Config = {
  AlipayNativeEnabled: boolean
  AlipayNativeSandbox: boolean
  AlipayNativeAppID: string
  AlipayNativeSellerID: string
  AlipayNativePrivateKey: string
  AlipayNativePublicKey: string
  AlipayNativeAppCert: string
  AlipayNativeAlipayCert: string
  AlipayNativeRootCert: string
  AlipayNativeUnitPrice: number
  AlipayNativeMinTopUp: number
  AlipayNativePrivateKeyConfigured?: boolean
}

const emptyConfig: Config = {
  AlipayNativeEnabled: false,
  AlipayNativeSandbox: false,
  AlipayNativeAppID: '',
  AlipayNativeSellerID: '',
  AlipayNativePrivateKey: '',
  AlipayNativePublicKey: '',
  AlipayNativeAppCert: '',
  AlipayNativeAlipayCert: '',
  AlipayNativeRootCert: '',
  AlipayNativeUnitPrice: 1,
  AlipayNativeMinTopUp: 1,
}

// This local, administrator-only panel intentionally uses Chinese copy.
export function AlipayNativeConfigPanel() {
  const [config, setConfig] = useState<Config>(emptyConfig)
  const [verificationMode, setVerificationMode] = useState<
    'public-key' | 'certificate'
  >('public-key')
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const mountedRef = useRef(true)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const res = await api.get('/api/option/alipay-native/config')
      if (!res.data?.success || !res.data.data) {
        throw res.data
      }
      if (mountedRef.current) {
        setConfig({
          ...emptyConfig,
          ...res.data.data,
          AlipayNativePrivateKey: '',
        })
        setVerificationMode(
          res.data.data.AlipayNativeAppCert.trim()
            ? 'certificate'
            : 'public-key'
        )
      }
    } catch (error) {
      if (mountedRef.current) {
        setLoadFailed(true)
        handleServerError(error)
      }
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void loadConfig()
    return () => {
      mountedRef.current = false
    }
  }, [loadConfig])

  const update = <K extends keyof Config>(key: K, value: Config[K]) =>
    setConfig((current) => ({ ...current, [key]: value }))
  const save = async () => {
    setSaving(true)
    try {
      const payload =
        verificationMode === 'certificate'
          ? { ...config, AlipayNativePublicKey: '' }
          : {
              ...config,
              AlipayNativeAppCert: '',
              AlipayNativeAlipayCert: '',
              AlipayNativeRootCert: '',
            }
      const response = await api.post(
        '/api/option/alipay-native/config',
        payload
      )
      if (!response.data?.success) {
        handleServerError(response.data)
        return
      }
      setConfig((current) => ({
        ...current,
        AlipayNativePrivateKey: '',
        AlipayNativePrivateKeyConfigured:
          current.AlipayNativePrivateKeyConfigured ||
          Boolean(current.AlipayNativePrivateKey),
      }))
      toast.success('支付宝当面付设置已保存')
    } catch (error) {
      handleServerError(error)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className='space-y-6'>
      <Alert>
        <AlertTitle>{'支付宝当面付'}</AlertTitle>
        <AlertDescription>
          {'直接对接支付宝当面付，不使用 Epay 网关配置'}
        </AlertDescription>
      </Alert>
      {config.AlipayNativeSandbox && (
        <Alert>
          <AlertTitle>{'支付宝沙箱'}</AlertTitle>
          <AlertDescription>
            {'当前为沙箱环境，不会扣除真实资金'}
          </AlertDescription>
        </Alert>
      )}
      {loadFailed && (
        <Alert variant='destructive'>
          <AlertTitle>{'配置加载失败'}</AlertTitle>
          <AlertDescription>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => void loadConfig()}
            >
              {'重试'}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className='flex items-center justify-between gap-4'>
        <Label htmlFor='alipay-native-enabled'>{'启用支付宝当面付'}</Label>
        <Switch
          id='alipay-native-enabled'
          checked={config.AlipayNativeEnabled}
          onCheckedChange={(value) => update('AlipayNativeEnabled', value)}
        />
      </div>
      <div className='flex items-center justify-between gap-4'>
        <Label htmlFor='alipay-native-sandbox'>{'使用支付宝沙箱'}</Label>
        <Switch
          id='alipay-native-sandbox'
          checked={config.AlipayNativeSandbox}
          onCheckedChange={(value) => update('AlipayNativeSandbox', value)}
        />
      </div>
      <div className='grid gap-4 md:grid-cols-2'>
        <div className='space-y-2'>
          <Label htmlFor='alipay-app-id'>{'应用 APPID'}</Label>
          <Input
            id='alipay-app-id'
            value={config.AlipayNativeAppID}
            onChange={(event) =>
              update('AlipayNativeAppID', event.target.value)
            }
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='alipay-seller-id'>{'商家 PID'}</Label>
          <Input
            id='alipay-seller-id'
            value={config.AlipayNativeSellerID}
            onChange={(event) =>
              update('AlipayNativeSellerID', event.target.value)
            }
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='alipay-unit-price'>
            {'充值单价（每 1 美元额度对应人民币）'}
          </Label>
          <Input
            id='alipay-unit-price'
            type='number'
            min='0'
            value={config.AlipayNativeUnitPrice}
            onChange={(event) =>
              update('AlipayNativeUnitPrice', Number(event.target.value))
            }
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='alipay-min-topup'>{'最低充值额度（美元）'}</Label>
          <Input
            id='alipay-min-topup'
            type='number'
            min='1'
            value={config.AlipayNativeMinTopUp}
            onChange={(event) =>
              update('AlipayNativeMinTopUp', Number(event.target.value))
            }
          />
        </div>
      </div>
      <div className='space-y-2'>
        <Label htmlFor='alipay-private-key'>{'应用私钥'}</Label>
        <Textarea
          id='alipay-private-key'
          value={config.AlipayNativePrivateKey}
          placeholder={
            config.AlipayNativePrivateKeyConfigured
              ? '已配置应用私钥，留空则保持不变'
              : undefined
          }
          onChange={(event) =>
            update('AlipayNativePrivateKey', event.target.value)
          }
        />
        <p className='text-muted-foreground text-xs'>
          {'应用私钥保存后不再回显'}
        </p>
      </div>
      <div className='space-y-2'>
        <Label>{'验签模式'}</Label>
        <div className='flex gap-2'>
          <Button
            type='button'
            variant={verificationMode === 'public-key' ? 'default' : 'outline'}
            aria-pressed={verificationMode === 'public-key'}
            onClick={() => setVerificationMode('public-key')}
          >
            {'公钥'}
          </Button>
          <Button
            type='button'
            variant={verificationMode === 'certificate' ? 'default' : 'outline'}
            aria-pressed={verificationMode === 'certificate'}
            onClick={() => setVerificationMode('certificate')}
          >
            {'证书'}
          </Button>
        </div>
      </div>
      {verificationMode === 'public-key' ? (
        <div className='space-y-2'>
          <Label htmlFor='alipay-public-key'>{'支付宝公钥'}</Label>
          <Textarea
            id='alipay-public-key'
            value={config.AlipayNativePublicKey}
            onChange={(event) =>
              update('AlipayNativePublicKey', event.target.value)
            }
          />
        </div>
      ) : (
        <div className='grid gap-4 md:grid-cols-3'>
          {(
            [
              'AlipayNativeAppCert',
              'AlipayNativeAlipayCert',
              'AlipayNativeRootCert',
            ] as const
          ).map((key) => {
            let label = '支付宝根证书'
            if (key === 'AlipayNativeAppCert') label = '应用公钥证书'
            if (key === 'AlipayNativeAlipayCert') label = '支付宝公钥证书'
            return (
              <div className='space-y-2' key={key}>
                <Label htmlFor={key}>{label}</Label>
                <Textarea
                  id={key}
                  value={config[key]}
                  onChange={(event) => update(key, event.target.value)}
                />
              </div>
            )
          })}
        </div>
      )}
      <Button
        type='button'
        onClick={() => void save()}
        disabled={loading || loadFailed || saving}
      >
        {saving ? '保存中…' : '保存支付宝当面付设置'}
      </Button>
    </div>
  )
}
