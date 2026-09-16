import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

export function AlipayNativeConfigPanel() {
  const { t } = useTranslation()
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
      toast.success(t('Alipay Native settings saved'))
    } catch (error) {
      handleServerError(error)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className='space-y-6'>
      <Alert>
        <AlertTitle>{t('Alipay Native')}</AlertTitle>
        <AlertDescription>
          {t(
            'Configure direct Alipay face-to-face payments. Epay settings are not used for this gateway.'
          )}
        </AlertDescription>
      </Alert>
      {config.AlipayNativeSandbox && (
        <Alert>
          <AlertTitle>{t('Alipay sandbox')}</AlertTitle>
          <AlertDescription>
            {t(
              'This is a sandbox configuration. No real funds will be charged.'
            )}
          </AlertDescription>
        </Alert>
      )}
      {loadFailed && (
        <Alert variant='destructive'>
          <AlertTitle>{t('Failed to load')}</AlertTitle>
          <AlertDescription>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => void loadConfig()}
            >
              {t('Retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className='flex items-center justify-between gap-4'>
        <Label htmlFor='alipay-native-enabled'>
          {t('Enable Alipay Native')}
        </Label>
        <Switch
          id='alipay-native-enabled'
          checked={config.AlipayNativeEnabled}
          onCheckedChange={(value) => update('AlipayNativeEnabled', value)}
        />
      </div>
      <div className='flex items-center justify-between gap-4'>
        <Label htmlFor='alipay-native-sandbox'>{t('Use Alipay sandbox')}</Label>
        <Switch
          id='alipay-native-sandbox'
          checked={config.AlipayNativeSandbox}
          onCheckedChange={(value) => update('AlipayNativeSandbox', value)}
        />
      </div>
      <div className='grid gap-4 md:grid-cols-2'>
        <div className='space-y-2'>
          <Label htmlFor='alipay-app-id'>{t('Alipay App ID')}</Label>
          <Input
            id='alipay-app-id'
            value={config.AlipayNativeAppID}
            onChange={(event) =>
              update('AlipayNativeAppID', event.target.value)
            }
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='alipay-seller-id'>{t('Alipay Seller ID')}</Label>
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
            {t('Alipay unit price (CNY per USD 1 of quota)')}
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
          <Label htmlFor='alipay-min-topup'>
            {t('Minimum topup amount (USD quota)')}
          </Label>
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
        <Label htmlFor='alipay-private-key'>{t('Alipay private key')}</Label>
        <Textarea
          id='alipay-private-key'
          value={config.AlipayNativePrivateKey}
          placeholder={
            config.AlipayNativePrivateKeyConfigured
              ? t(
                  'A private key is already configured. Leave blank to keep it unchanged.'
                )
              : undefined
          }
          onChange={(event) =>
            update('AlipayNativePrivateKey', event.target.value)
          }
        />
        <p className='text-muted-foreground text-xs'>
          {t('Private keys are never displayed after saving.')}
        </p>
      </div>
      <div className='space-y-2'>
        <Label>{t('Mode')}</Label>
        <div className='flex gap-2'>
          <Button
            type='button'
            variant={verificationMode === 'public-key' ? 'default' : 'outline'}
            aria-pressed={verificationMode === 'public-key'}
            onClick={() =>
              setVerificationMode('public-key')
            }
          >
              {t('Public key')}
          </Button>
          <Button
            type='button'
            variant={verificationMode === 'certificate' ? 'default' : 'outline'}
            aria-pressed={verificationMode === 'certificate'}
            onClick={() =>
              setVerificationMode('certificate')
            }
          >
              {t('Certificates')}
          </Button>
        </div>
      </div>
      {verificationMode === 'public-key' ? (
        <div className='space-y-2'>
        <Label htmlFor='alipay-public-key'>{t('Alipay public key')}</Label>
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
          let label = t('Alipay root certificate')
          if (key === 'AlipayNativeAppCert') label = t('App certificate')
          if (key === 'AlipayNativeAlipayCert') label = t('Alipay certificate')
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
        {saving ? t('Saving...') : t('Save Alipay Native settings')}
      </Button>
    </div>
  )
}
