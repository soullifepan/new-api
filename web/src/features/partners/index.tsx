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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { useState } from 'react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import {
  getPartnerConfig,
  listPartners,
  listPayouts,
  listCommissions,
  reviewPartner,
  reviewPayout,
  type Partner,
  type Payout,
  type Commission,
} from './api'
import { PartnerCommissionRate } from './commission-rate'
import { PartnerSettings } from './config'

const partnerStatus: Record<string, string> = {
  pending: '待处理',
  needs_info: '待补充',
  approved: '已通过',
  rejected: '已驳回',
  suspended: '已暂停',
  paid: '已结算',
}
const kindLabels: Record<string, string> = {
  alipay: '对私支付宝',
  bank: '对公账户',
  balance: '转消费余额',
}
const date = (timestamp: number) =>
  timestamp ? new Date(timestamp * 1000).toLocaleString('zh-CN') : '—'

type Review = { id: number; status: string; title: string; payout?: Payout }

export function PartnersAdmin() {
  const config = useQuery({
    queryKey: ['partners', 'config'],
    queryFn: getPartnerConfig,
  })
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>合作伙伴</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <Tabs defaultValue='partners' className='gap-5'>
          <TabsList aria-label='合作伙伴管理'>
            {[
              ['partners', '申请与伙伴'],
              ['payouts', '提现与划转'],
              ['commissions', '充值佣金'],
              ['config', '返佣规则'],
            ].map(([id, label]) => (
              <TabsTrigger key={id} value={id}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value='config'>
            {config.isLoading && <LoadingState />}
            {config.isError && (
              <ErrorState
                title='规则加载失败'
                onRetry={() => config.refetch()}
              />
            )}
            {config.data && (
              <PartnerSettings
                key={config.dataUpdatedAt}
                config={config.data}
              />
            )}
          </TabsContent>
          <TabsContent value='partners'>
            <PartnerList globalCommissionBPS={config.data?.commission_bps} />
          </TabsContent>
          <TabsContent value='payouts'>
            <PayoutList />
          </TabsContent>
          <TabsContent value='commissions'>
            <CommissionList />
          </TabsContent>
        </Tabs>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function PartnerList(props: { globalCommissionBPS?: number }) {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [filter, setFilter] = useState('pending')
  const [detail, setDetail] = useState<Partner | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [note, setNote] = useState('')
  const client = useQueryClient()
  const query = useQuery({
    queryKey: [
      'partners',
      'list',
      pagination.pageIndex,
      pagination.pageSize,
      filter,
    ],
    queryFn: () =>
      listPartners(pagination.pageIndex + 1, filter, pagination.pageSize),
  })
  const mutation = useMutation({
    mutationFn: () => {
      if (!review) throw new Error('未选择审核记录')
      return reviewPartner(review.id, review.status, note)
    },
    onSuccess: () => {
      toast.success('审核结果已保存')
      setReview(null)
      setDetail(null)
      client.invalidateQueries({ queryKey: ['partners'] })
    },
  })
  const startReview = (p: Partner, status: string, title: string) => {
    setNote('')
    setReview({ id: p.user_id, status, title })
  }
  const columns: ColumnDef<Partner>[] = [
    { accessorKey: 'user_id', header: '用户 ID' },
    {
      accessorKey: 'status',
      header: '状态',
      cell: ({ row }) =>
        partnerStatus[row.original.status] ?? row.original.status,
    },
    { accessorKey: 'channels', header: '推广渠道' },
    {
      accessorKey: 'commission_bps',
      header: '返佣比例',
      cell: ({ row }) =>
        row.original.commission_bps == null
          ? `全局 ${props.globalCommissionBPS === undefined ? '—' : `${formatNumber(props.globalCommissionBPS / 100, 'zh-CN')}%`}`
          : `${formatNumber(row.original.commission_bps / 100, 'zh-CN')}%（专属）`,
    },
    {
      accessorKey: 'earned_quota',
      header: '累计佣金',
      cell: ({ row }) => formatQuotaWithCurrency(row.original.earned_quota),
    },
    {
      accessorKey: 'available_quota',
      header: '可用佣金',
      cell: ({ row }) => formatQuotaWithCurrency(row.original.available_quota),
    },
    {
      accessorKey: 'updated_at',
      header: '更新时间',
      cell: ({ row }) => date(row.original.updated_at),
    },
    {
      id: 'actions',
      header: '操作',
      cell: ({ row }) => (
        <Button
          variant='outline'
          size='sm'
          onClick={() => setDetail(row.original)}
        >
          查看资料
        </Button>
      ),
    },
  ]
  const { table } = useDataTable({
    data: query.data?.items ?? [],
    columns,
    manualPagination: true,
    totalCount: query.data?.total ?? 0,
    pagination,
    onPaginationChange: setPagination,
    enableSorting: false,
  })
  return (
    <>
      <FilterButtons
        value={filter}
        options={[
          'pending',
          'needs_info',
          'approved',
          'rejected',
          'suspended',
          '',
        ]}
        onChange={(v) => {
          setFilter(v)
          setPagination({ ...pagination, pageIndex: 0 })
        }}
      />
      {query.isError ? (
        <ErrorState title='伙伴列表加载失败' onRetry={() => query.refetch()} />
      ) : (
        <DataTablePage
          table={table}
          columns={columns}
          isLoading={query.isLoading}
          isFetching={query.isFetching}
          emptyTitle='暂无合作伙伴'
          skeletonKeyPrefix='partners'
        />
      )}
      <Dialog
        open={detail !== null}
        onOpenChange={(v) => {
          if (!v) setDetail(null)
        }}
        title='合作伙伴资料'
        footer={
          detail && (
            <div className='flex flex-wrap gap-2'>
              {detail.status === 'pending' && (
                <>
                  <Button
                    onClick={() => startReview(detail, 'approved', '通过申请')}
                  >
                    通过申请
                  </Button>
                  <Button
                    variant='outline'
                    onClick={() =>
                      startReview(detail, 'needs_info', '要求补充资料')
                    }
                  >
                    要求补充资料
                  </Button>
                  <Button
                    variant='destructive'
                    onClick={() => startReview(detail, 'rejected', '驳回申请')}
                  >
                    驳回申请
                  </Button>
                </>
              )}
              {detail.status === 'approved' && (
                <Button
                  variant='destructive'
                  onClick={() => startReview(detail, 'suspended', '暂停合作')}
                >
                  暂停合作
                </Button>
              )}
              {detail.status === 'suspended' && (
                <Button
                  onClick={() => startReview(detail, 'approved', '恢复合作')}
                >
                  恢复合作
                </Button>
              )}
            </div>
          )
        }
      >
        {detail && (
          <div className='space-y-5'>
            <dl className='space-y-3'>
              {[
                ['用户 ID', String(detail.user_id)],
                ['推广渠道', detail.channels],
                ['账号链接', detail.links],
                ['推广计划', detail.plan],
                ['联系方式', detail.contact],
                ['证明链接', detail.evidence],
                ['补充说明', detail.notes],
                ['审核意见', detail.review_note],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className='text-muted-foreground text-sm'>{label}</dt>
                  <dd className='break-all whitespace-pre-wrap'>
                    {value || '—'}
                  </dd>
                </div>
              ))}
            </dl>
            {props.globalCommissionBPS !== undefined && (
              <PartnerCommissionRate
                key={`${detail.user_id}:${detail.commission_bps}`}
                partner={detail}
                globalCommissionBPS={props.globalCommissionBPS}
                onSaved={setDetail}
              />
            )}
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={review !== null}
        onOpenChange={(v) => {
          if (!v && !mutation.isPending) setReview(null)
        }}
        title={review?.title ?? ''}
        desc={`用户 ID：${review?.id ?? ''}`}
        confirmText='确认'
        cancelBtnText='取消'
        isLoading={mutation.isPending}
        disabled={review?.status !== 'approved' && !note.trim()}
        handleConfirm={() => mutation.mutate()}
      >
        <Label htmlFor='partner-review-note'>
          审核意见{review?.status !== 'approved' ? '（必填）' : ''}
        </Label>
        <Textarea
          id='partner-review-note'
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
        />
      </ConfirmDialog>
    </>
  )
}

function PayoutList() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [filter, setFilter] = useState('pending')
  const [review, setReview] = useState<Review | null>(null)
  const [detail, setDetail] = useState<Payout | null>(null)
  const [note, setNote] = useState('')
  const client = useQueryClient()
  const query = useQuery({
    queryKey: [
      'partners',
      'payouts',
      pagination.pageIndex,
      pagination.pageSize,
      filter,
    ],
    queryFn: () =>
      listPayouts(pagination.pageIndex + 1, filter, pagination.pageSize),
  })
  const mutation = useMutation({
    mutationFn: () => {
      if (!review) throw new Error('未选择结算申请')
      return reviewPayout(review.id, review.status, note)
    },
    onSuccess: () => {
      toast.success('结算记录已更新')
      setReview(null)
      setDetail(null)
      client.invalidateQueries({ queryKey: ['partners'] })
    },
  })
  const columns: ColumnDef<Payout>[] = [
    { accessorKey: 'id', header: '申请编号' },
    { accessorKey: 'user_id', header: '用户 ID' },
    {
      accessorKey: 'kind',
      header: '方式',
      cell: ({ row }) => kindLabels[row.original.kind] ?? row.original.kind,
    },
    {
      accessorKey: 'amount',
      header: '金额（人民币）',
      cell: ({ row }) =>
        `¥${formatNumber(Number(row.original.amount), 'zh-CN')}`,
    },
    {
      accessorKey: 'status',
      header: '状态',
      cell: ({ row }) =>
        partnerStatus[row.original.status] ?? row.original.status,
    },
    {
      accessorKey: 'created_at',
      header: '申请时间',
      cell: ({ row }) => date(row.original.created_at),
    },
    {
      id: 'actions',
      header: '操作',
      cell: ({ row }) => (
        <Button
          size='sm'
          variant='outline'
          onClick={() => setDetail(row.original)}
        >
          查看申请
        </Button>
      ),
    },
  ]
  const { table } = useDataTable({
    data: query.data?.items ?? [],
    columns,
    manualPagination: true,
    totalCount: query.data?.total ?? 0,
    pagination,
    onPaginationChange: setPagination,
    enableSorting: false,
  })
  const start = (status: string, title: string) => {
    if (detail) {
      setNote('')
      setReview({ id: detail.id, status, title, payout: detail })
    }
  }
  return (
    <>
      <p className='text-muted-foreground text-sm'>
        实际转账在支付宝或银行独立完成。确认到账后再标记已打款；提交申请时已占用佣金，完成时不会重复扣款。
      </p>
      <FilterButtons
        value={filter}
        options={['pending', 'paid', 'rejected', '']}
        onChange={(v) => {
          setFilter(v)
          setPagination({ ...pagination, pageIndex: 0 })
        }}
      />
      {query.isError ? (
        <ErrorState title='结算记录加载失败' onRetry={() => query.refetch()} />
      ) : (
        <DataTablePage
          table={table}
          columns={columns}
          isLoading={query.isLoading}
          isFetching={query.isFetching}
          emptyTitle='暂无结算记录'
          skeletonKeyPrefix='partner-payouts'
        />
      )}
      <Dialog
        open={detail !== null}
        onOpenChange={(v) => {
          if (!v) setDetail(null)
        }}
        title='结算申请'
        footer={
          detail?.status === 'pending' &&
          detail.kind !== 'balance' && (
            <>
              <Button
                variant='destructive'
                onClick={() => start('rejected', '驳回提现')}
              >
                驳回
              </Button>
              <Button onClick={() => start('paid', '确认已在站外完成打款')}>
                标记已打款
              </Button>
            </>
          )
        }
      >
        {detail && (
          <dl className='space-y-3'>
            {[
              ['申请编号', String(detail.id)],
              ['用户 ID', String(detail.user_id)],
              ['金额', `${detail.amount} ${detail.currency}`],
              ['方式', kindLabels[detail.kind]],
              ['收款人 / 企业', detail.recipient_name],
              ['收款账号', detail.account],
              ['开户行', detail.bank_name],
              ['统一社会信用代码', detail.company_code],
              ['提交时汇率', detail.exchange_rate],
              ['划转时售价', detail.credit_price],
              [
                '到账消费额度',
                detail.quota ? formatQuotaWithCurrency(detail.quota) : '—',
              ],
              ['处理人', String(detail.reviewed_by || '—')],
              ['处理时间', date(detail.completed_at)],
              ['备注', detail.review_note],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className='text-muted-foreground text-sm'>{label}</dt>
                <dd className='break-all whitespace-pre-wrap'>
                  {value || '—'}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Dialog>
      <ConfirmDialog
        open={review !== null}
        onOpenChange={(v) => {
          if (!v && !mutation.isPending) setReview(null)
        }}
        title={review?.title ?? ''}
        desc={
          <div className='space-y-2'>
            <p>
              {review?.payout?.amount} {review?.payout?.currency}
            </p>
            <p>
              {review?.payout?.recipient_name} · {review?.payout?.account}
            </p>
            <p>
              {review?.status === 'paid'
                ? '此操作只登记已完成的付款，不会发起转账。'
                : '驳回后释放占用的佣金。'}
            </p>
          </div>
        }
        confirmText={review?.status === 'paid' ? '确认已打款' : '确认驳回'}
        cancelBtnText='取消'
        isLoading={mutation.isPending}
        disabled={review?.status === 'rejected' && !note.trim()}
        handleConfirm={() => mutation.mutate()}
      >
        <Label htmlFor='payout-review-note'>
          备注{review?.status === 'rejected' ? '（必填）' : ''}
        </Label>
        <Textarea
          id='payout-review-note'
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </ConfirmDialog>
    </>
  )
}

function CommissionList() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const query = useQuery({
    queryKey: [
      'partners',
      'commissions',
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: () =>
      listCommissions(pagination.pageIndex + 1, pagination.pageSize),
  })
  const columns: ColumnDef<Commission>[] = [
    { accessorKey: 'partner_id', header: '伙伴 ID' },
    { accessorKey: 'user_id', header: '客户 ID' },
    { accessorKey: 'topup_id', header: '充值单 ID' },
    {
      accessorKey: 'reason',
      header: '说明',
      cell: ({ row }) =>
        row.original.reason === 'unsupported_currency'
          ? '该付款币种未配置返佣汇率，未计佣金'
          : '—',
    },
    {
      accessorKey: 'paid_amount',
      header: '实际付款',
      cell: ({ row }) =>
        `${row.original.paid_amount} ${row.original.paid_currency}`,
    },
    {
      accessorKey: 'commission_bps',
      header: '规则比例',
      cell: ({ row }) =>
        `${formatNumber(row.original.commission_bps / 100, 'zh-CN')}%`,
    },
    {
      accessorKey: 'commission_quota',
      header: '本笔佣金',
      cell: ({ row }) => formatQuotaWithCurrency(row.original.commission_quota),
    },
    {
      accessorKey: 'created_at',
      header: '充值时间',
      cell: ({ row }) => date(row.original.created_at),
    },
  ]
  const { table } = useDataTable({
    data: query.data?.items ?? [],
    columns,
    manualPagination: true,
    totalCount: query.data?.total ?? 0,
    pagination,
    onPaginationChange: setPagination,
    enableSorting: false,
  })
  return (
    <>
      <p className='text-muted-foreground text-sm'>
        仅统计计划启用后、有可靠实付金额且邀请人已有申请记录的充值。0
        佣金表示该笔充值不符合返佣条件；注册奖励、消费和订阅不参与。
      </p>
      {query.isError ? (
        <ErrorState title='佣金记录加载失败' onRetry={() => query.refetch()} />
      ) : (
        <DataTablePage
          table={table}
          columns={columns}
          isLoading={query.isLoading}
          isFetching={query.isFetching}
          emptyTitle='暂无充值佣金'
          skeletonKeyPrefix='partner-commissions'
        />
      )}
    </>
  )
}
function FilterButtons(props: {
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <div className='flex flex-wrap gap-2' aria-label='状态筛选'>
      {props.options.map((status) => (
        <Button
          key={status}
          size='sm'
          variant={props.value === status ? 'default' : 'outline'}
          aria-pressed={props.value === status}
          onClick={() => props.onChange(status)}
        >
          {status ? partnerStatus[status] : '全部'}
        </Button>
      ))}
    </div>
  )
}
