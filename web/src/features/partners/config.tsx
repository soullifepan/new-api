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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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
          汇率、展示单位及充值售价沿用系统现有设置。修改规则只影响之后的充值，不重算历史佣金。关闭推广后仍可结算历史收益。
        </p>
        <div className='flex flex-wrap gap-6'>
          {(['enabled', 'first_topup_only'] as const).map((name) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem className='flex items-center gap-2'>
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormLabel>
                    {name === 'enabled'
                      ? '开启合作伙伴计划'
                      : '仅客户首次充值返佣'}
                  </FormLabel>
                </FormItem>
              )}
            />
          ))}
        </div>
        <FormField
          control={form.control}
          name='balance_price_source'
          render={({ field }) => (
            <FormItem>
              <FormLabel>转消费额度采用的现有充值售价</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {[
                    ['epay', '易支付'],
                    ['alipay_native', '支付宝当面付'],
                    ['waffo', 'Waffo'],
                    ['waffo_pancake', 'Waffo Pancake'],
                  ].map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
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
          返佣期限从客户注册与伙伴首次获批中较晚的时间起算；首充以客户历史首次成功充值为准。无手续费，佣金即时可用。
        </p>
        <Button type='submit' disabled={save.isPending}>
          {save.isPending ? '保存中…' : '保存规则'}
        </Button>
      </form>
    </Form>
  )
}
