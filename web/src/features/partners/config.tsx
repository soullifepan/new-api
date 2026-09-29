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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

import { savePartnerConfig, type PartnerConfig } from './api'
import { partnerConfigSchema } from './schema'

const fields = [
  ['commission_bps', '返佣比例（%）'],
  ['duration_days', '返佣天数（0 表示长期）'],
  ['min_payout_cents', '最低提现金额（人民币元）'],
  ['alipay_daily_limit_cents', '支付宝每日限额（人民币元，0 不限）'],
  ['bank_single_limit_cents', '对公单笔限额（人民币元，0 不限）'],
] as const
export function PartnerSettings(props: { config: PartnerConfig }) {
  const client = useQueryClient()
  const form = useForm<PartnerConfig>({
    resolver: zodResolver(partnerConfigSchema),
    defaultValues: props.config,
  })
  const save = useMutation({
    mutationFn: savePartnerConfig,
    onSuccess: () => {
      toast.success('合作伙伴规则已保存')
      client.invalidateQueries({ queryKey: ['partners'] })
    },
  })
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
        className='max-w-3xl space-y-5'
      >
        <p className='text-muted-foreground text-sm'>
          汇率、展示单位及充值售价沿用系统现有设置。修改规则只影响之后的充值，不重算历史佣金。关闭申请仅停止接收新申请，已获批伙伴的邀请、返佣、提现与划转不受影响。
        </p>
        <FormField
          control={form.control}
          name='enabled'
          render={({ field }) => (
            <FormItem className='flex items-center gap-2'>
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <FormLabel>开放合作伙伴申请</FormLabel>
            </FormItem>
          )}
        />
        <p className='text-muted-foreground text-sm'>
          佣金转余额按 TapComfy
          当前充值价格兑换，包含用户分组倍率。后台调整充值价格后自动同步，无需在此单独设置。
        </p>
        <div className='grid gap-4 sm:grid-cols-2'>
          {fields.map(([name, label]) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{label}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      step={name === 'duration_days' ? '1' : '0.01'}
                      min={name === 'min_payout_cents' ? 0.01 : 0}
                      {...field}
                      value={
                        Number.isFinite(field.value)
                          ? field.value / (name === 'duration_days' ? 1 : 100)
                          : ''
                      }
                      onChange={(e) => {
                        if (e.target.value === '') {
                          field.onChange(Number.NaN)
                          return
                        }
                        const value = Number(e.target.value)
                        field.onChange(
                          name === 'duration_days'
                            ? value
                            : Math.round(value * 100)
                        )
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </div>
        <p className='text-muted-foreground text-sm'>
          返佣有效期内，客户每次充值均按设定比例返佣。期限从客户注册与伙伴首次获批中较晚的时间起算。无手续费，佣金即时可用。
        </p>
        <Button type='submit' disabled={save.isPending}>
          {save.isPending ? '保存中…' : '保存规则'}
        </Button>
      </form>
    </Form>
  )
}
