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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, History } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout/components/section-page-layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TitledCard } from '@/components/ui/titled-card'
import { formatQuotaWithCurrency } from '@/lib/currency'
import dayjs from '@/lib/dayjs'
import { handleServerError } from '@/lib/handle-server-error'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import {
  createWalletTransfer,
  getWalletTransferSummary,
  getWalletTransfers,
  type WalletTransfer,
  type WalletTransferRequest,
} from './api'

const transferFormSchema = z.object({
  sourceUsername: z.string().trim().max(20),
  recipient: z.string().trim().min(1).max(20),
  amount: z.string().refine((value) => {
    return /^\d+(\.\d{1,6})?$/.test(value) && Number(value) > 0
  }),
})

type TransferForm = z.infer<typeof transferFormSchema>

export function WalletTransfers() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.auth.user)
  const isAdmin = (user?.role ?? 0) >= ROLE.ADMIN
  const [page, setPage] = useState(1)
  const [pending, setPending] = useState<TransferForm | null>(null)
  const [retryKey, setRetryKey] = useState<{
    fingerprint: string
    id: string
  } | null>(null)
  const form = useForm<TransferForm>({
    resolver: zodResolver(transferFormSchema),
    defaultValues: { sourceUsername: '', recipient: '', amount: '' },
  })
  const summaryQuery = useQuery({
    queryKey: ['wallet-transfers', 'summary'],
    queryFn: getWalletTransferSummary,
  })
  const currency = summaryQuery.data?.currency ?? 'USD'
  let currencyLabel: string = currency
  if (currency === 'CUSTOM') {
    currencyLabel = summaryQuery.data?.currency_symbol || currency
  } else if (currency === 'TOKENS') {
    currencyLabel = t('Tokens')
  }
  const historyQuery = useQuery({
    queryKey: ['wallet-transfers', 'history', page],
    queryFn: () => getWalletTransfers(page),
  })
  const transferMutation = useMutation({
    mutationFn: (payload: { request: WalletTransferRequest; admin: boolean }) =>
      createWalletTransfer(payload.request, payload.admin),
    meta: { errorToast: false },
    onSuccess: async () => {
      setPending(null)
      setRetryKey(null)
      form.reset()
      setPage(1)
      await queryClient.invalidateQueries({ queryKey: ['wallet-transfers'] })
      await queryClient.invalidateQueries({ queryKey: ['wallet'] })
      toast.success(t('Transfer completed'))
    },
    onError: (error) =>
      handleServerError(error, t('Unable to transfer balance')),
  })

  const confirmTransfer = () => {
    if (!pending || transferMutation.isPending) return
    const fingerprint = JSON.stringify(pending)
    const requestID =
      retryKey?.fingerprint === fingerprint ? retryKey.id : crypto.randomUUID()
    setRetryKey({ fingerprint, id: requestID })
    transferMutation.mutate({
      admin: isAdmin && pending.sourceUsername !== '',
      request: {
        source_username: pending.sourceUsername || undefined,
        recipient: pending.recipient,
        amount: pending.amount,
        currency,
        exchange_rate: summaryQuery.data?.exchange_rate ?? '',
        request_id: requestID,
      },
    })
  }

  const transferableQuota = summaryQuery.data?.transferable_quota ?? 0
  let availableAmount = 0
  if (summaryQuery.data) {
    if (currency === 'TOKENS') {
      availableAmount = transferableQuota
    } else {
      availableAmount =
        (transferableQuota / summaryQuery.data.quota_per_unit) *
        Number(summaryQuery.data.exchange_rate)
    }
  }

  const columns: StaticDataTableColumn<WalletTransfer>[] = [
    {
      id: 'date',
      header: t('Date'),
      cell: (row) => dayjs.unix(row.created_at).format('YYYY-MM-DD HH:mm'),
    },
    {
      id: 'direction',
      header: t('Direction'),
      cell: (row) => {
        if (row.source_user_id === user?.id) return t('Sent')
        if (row.target_user_id === user?.id) return t('Received')
        return t('Transfer')
      },
    },
    {
      id: 'counterparty',
      header: t('Counterparty'),
      cell: (row) => {
        if (row.source_user_id === user?.id) return row.target_username
        if (row.target_user_id === user?.id) return row.source_username
        return `${row.source_username} → ${row.target_username}`
      },
    },
    {
      id: 'amount',
      header: t('Amount'),
      cell: (row) => formatQuotaWithCurrency(row.quota),
    },
  ]

  let balanceContent: ReactNode
  if (summaryQuery.isPending) {
    balanceContent = <LoadingState size='sm' />
  } else if (summaryQuery.isError) {
    balanceContent = <ErrorState onRetry={() => void summaryQuery.refetch()} />
  } else {
    balanceContent = (
      <div className='bg-muted/50 mb-5 rounded-lg p-4'>
        <p className='text-muted-foreground text-sm'>
          {t('Transferable balance')}
        </p>
        <p className='mt-1 text-2xl font-semibold tabular-nums'>
          {formatQuotaWithCurrency(summaryQuery.data.transferable_quota)}
        </p>
        <p className='text-muted-foreground mt-2 text-sm'>
          {t('Frozen and not transferable: {{amount}}', {
            amount: formatQuotaWithCurrency(summaryQuery.data.reserve_quota),
          })}
        </p>
      </div>
    )
  }

  let historyContent: ReactNode
  if (historyQuery.isPending) {
    historyContent = <LoadingState size='sm' />
  } else if (historyQuery.isError) {
    historyContent = <ErrorState onRetry={() => void historyQuery.refetch()} />
  } else if (historyQuery.data.items.length === 0) {
    historyContent = (
      <EmptyState title={t('No transfers yet')} className='min-h-[180px]' />
    )
  } else {
    historyContent = (
      <>
        <StaticDataTable
          columns={columns}
          data={historyQuery.data.items}
          getRowKey={(row) => row.id}
        />
        <div className='mt-4 flex items-center justify-between gap-3'>
          <Button
            variant='outline'
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            {t('Previous')}
          </Button>
          <span className='text-muted-foreground text-sm'>
            {t('Page {{page}} of {{total}}', {
              page,
              total: Math.max(1, Math.ceil(historyQuery.data.total / 20)),
            })}
          </span>
          <Button
            variant='outline'
            disabled={page * 20 >= historyQuery.data.total}
            onClick={() => setPage(page + 1)}
          >
            {t('Next')}
          </Button>
        </div>
      </>
    )
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Balance Transfers')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]'>
          <TitledCard
            title={t('Transfer balance')}
            description={t('Move wallet balance between accounts')}
            icon={<ArrowLeftRight className='size-4' />}
          >
            {balanceContent}
            {!summaryQuery.isPending &&
              !summaryQuery.data?.transfer_enabled && (
                <p role='status' className='text-muted-foreground mb-4 text-sm'>
                  {t('Transfers are temporarily unavailable.')}
                </p>
              )}
            <form
              className='space-y-4'
              onSubmit={form.handleSubmit((values) => {
                if (!values.sourceUsername && Number(values.amount) > Math.round(availableAmount * 1e6) / 1e6) {
                  form.setError('amount', { message: t('Amount exceeds transferable balance') })
                  return
                }
                setPending(values)
              })}
            >
              {isAdmin && (
                <div className='space-y-2'>
                  <Label htmlFor='transfer-source'>
                    {t('Source username (optional)')}
                  </Label>
                  <Input
                    id='transfer-source'
                    autoComplete='off'
                    {...form.register('sourceUsername')}
                  />
                  {form.formState.errors.sourceUsername && (
                    <p role='alert' className='text-destructive text-sm'>
                      {t('Invalid source username')}
                    </p>
                  )}
                </div>
              )}
              <div className='space-y-2'>
                <Label htmlFor='transfer-recipient' required>
                  {t('Recipient username')}
                </Label>
                <Input
                  id='transfer-recipient'
                  autoComplete='off'
                  {...form.register('recipient')}
                />
                {form.formState.errors.recipient && (
                  <p role='alert' className='text-destructive text-sm'>
                    {t('Enter a valid recipient username')}
                  </p>
                )}
              </div>
              <div className='space-y-2'>
                <Label htmlFor='transfer-amount' required>
                  {t('Amount ({{currency}})', { currency: currencyLabel })}
                </Label>
                <Input
                  id='transfer-amount'
                  inputMode='decimal'
                  autoComplete='off'
                  {...form.register('amount')}
                />
                {form.formState.errors.amount && (
                  <p role='alert' className='text-destructive text-sm'>
                    {form.formState.errors.amount.message || t('Enter a valid amount')}
                  </p>
                )}
              </div>
              <Button
                type='submit'
                disabled={
                  !summaryQuery.data?.transfer_enabled ||
                  (!form.watch('sourceUsername') && transferableQuota === 0) ||
                  transferMutation.isPending
                }
              >
                {t('Transfer')}
              </Button>
            </form>
          </TitledCard>

          <TitledCard
            title={t('Transfer history')}
            description={t('Your incoming and outgoing wallet transfers')}
            icon={<History className='size-4' />}
          >
            {historyContent}
          </TitledCard>
        </div>
        <ConfirmDialog
          open={pending !== null}
          onOpenChange={(open) => {
            if (!open && !transferMutation.isPending) setPending(null)
          }}
          title={t('Confirm transfer')}
          desc={t('Transfer {{amount}} {{currency}} to {{recipient}}?', {
            amount: pending?.amount ?? '',
            currency: currencyLabel,
            recipient: pending?.recipient ?? '',
          })}
          confirmText={t('Transfer')}
          isLoading={transferMutation.isPending}
          handleConfirm={confirmTransfer}
        >
          {pending?.sourceUsername && (
            <p className='text-muted-foreground text-sm'>
              {t('From account: {{source}}', {
                source: pending.sourceUsername,
              })}
            </p>
          )}
        </ConfirmDialog>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
