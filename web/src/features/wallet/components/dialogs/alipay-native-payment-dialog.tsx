import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import type { AlipayNativePayment } from '../../types'

type AlipayNativePaymentDialogProps = {
  payment: AlipayNativePayment | null
  status: 'pending' | 'failed' | 'expired' | 'network-error'
  onRetry: () => void
  onOpenChange: (open: boolean) => void
}

export function AlipayNativePaymentDialog(
  props: AlipayNativePaymentDialogProps
) {
  const { t } = useTranslation()
  const payment = props.payment
  const hasQrCode = Boolean(payment?.qr_code)
  let statusText = t('Waiting for payment')
  if (props.status === 'failed') statusText = t('Payment failed')
  if (props.status === 'expired') statusText = t('Payment expired')
  if (props.status === 'network-error') {
    statusText = t('Network connection failed or server not responding')
  }
  return (
    <Dialog open={Boolean(payment)} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('Scan with Alipay to pay')}</DialogTitle>
          <DialogDescription>
            {t('Keep this dialog open while payment is being confirmed.')}
          </DialogDescription>
        </DialogHeader>
        {payment?.sandbox && (
          <Alert>
            <AlertTitle>{t('Alipay sandbox')}</AlertTitle>
            <AlertDescription>
              {t('This is a sandbox payment. No real funds will be charged.')}
            </AlertDescription>
          </Alert>
        )}
        {payment && (
          <div className='flex flex-col items-center gap-4 py-2'>
            {hasQrCode ? (
              <QRCodeSVG value={payment?.qr_code ?? ''} size={220} level='M' />
            ) : (
              <Alert variant='destructive'>
                <AlertTitle>{t('Payment request failed')}</AlertTitle>
                <AlertDescription>
                  {t('The order is being checked. Do not submit another payment request.')}
                </AlertDescription>
              </Alert>
            )}
            {props.status === 'network-error' && (
              <Alert variant='destructive'>
                <AlertTitle>{t('Network connection failed or server not responding')}</AlertTitle>
                <AlertDescription>
                  <Button type='button' size='sm' variant='outline' onClick={props.onRetry}>
                    {t('Retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <dl className='w-full space-y-2 text-sm'>
              {payment.amount && payment.currency && (
                <div className='flex justify-between gap-4'>
                  <dt className='text-muted-foreground'>
                    {t('Amount to pay:')}
                  </dt>
                  <dd className='font-semibold'>
                    ¥{payment.amount} {payment.currency}
                  </dd>
                </div>
              )}
              <div className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>{t('Order number')}</dt>
                <dd className='max-w-56 truncate font-mono text-xs'>
                  {payment.trade_no}
                </dd>
              </div>
              <div className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>{t('Payment status')}</dt>
                <dd>{statusText}</dd>
              </div>
            </dl>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
