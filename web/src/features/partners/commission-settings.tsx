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
import { z } from 'zod'

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
import { formatNumber } from '@/lib/format'

import { updatePartnerCommission, type Partner } from './api'

const schema = z.object({
  useDefault: z.boolean(),
  useDefaultDuration: z.boolean(),
  days: z
    .number({ error: '请输入有效天数' })
    .int('天数必须是整数')
    .min(0, '天数不能小于 0')
    .max(36500, '天数不能超过 36500'),
  percent: z
    .number({ error: '请输入有效比例' })
    .min(0, '比例不能小于 0%')
    .max(100, '比例不能超过 100%')
    .multipleOf(0.01, '最多保留两位小数'),
})
type RateForm = z.infer<typeof schema>

export function PartnerCommissionSettings(props: {
  partner: Partner
  globalCommissionBPS: number
  globalDurationDays: number
  onSaved: (partner: Partner) => void
}) {
  const client = useQueryClient()
  const form = useForm<RateForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      useDefault: props.partner.commission_bps == null,
      useDefaultDuration: props.partner.duration_days == null,
      days: props.partner.duration_days ?? props.globalDurationDays,
      percent:
        (props.partner.commission_bps ?? props.globalCommissionBPS) / 100,
    },
  })
  const save = useMutation({
    mutationFn: (values: RateForm) =>
      updatePartnerCommission(props.partner.user_id, {
        commission_bps: values.useDefault
          ? null
          : Math.round(values.percent * 100),
        duration_days: values.useDefaultDuration ? null : values.days,
      }),
    onSuccess: (partner) => {
      props.onSaved(partner)
      client.invalidateQueries({ queryKey: ['partners'] })
      toast.success('返佣设置已保存')
    },
  })
  const useDefault = form.watch('useDefault')
  const useDefaultDuration = form.watch('useDefaultDuration')
  return (
    <Form {...form}>
      <form
        className='space-y-3 border-t pt-4'
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
      >
        <h3 className='font-medium'>专属返佣比例</h3>
        <FormField
          control={form.control}
          name='useDefault'
          render={({ field }) => (
            <FormItem className='flex items-center gap-2'>
              <FormControl>
                <Checkbox
                  checked={field.value}
                  disabled={save.isPending}
                  onCheckedChange={(checked) => {
                    field.onChange(checked)
                    if (checked) {
                      form.setValue(
                        'percent',
                        props.globalCommissionBPS / 100,
                        { shouldValidate: true }
                      )
                    }
                  }}
                />
              </FormControl>
              <FormLabel>
                沿用全局比例（
                {formatNumber(props.globalCommissionBPS / 100, 'zh-CN')}%）
              </FormLabel>
            </FormItem>
          )}
        />
        {!useDefault && (
          <FormField
            control={form.control}
            name='percent'
            render={({ field }) => (
              <FormItem>
                <FormLabel>返佣比例（%）</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    max={100}
                    step={0.01}
                    disabled={save.isPending}
                    {...field}
                    value={Number.isFinite(field.value) ? field.value : ''}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === ''
                          ? Number.NaN
                          : Number(event.target.value)
                      )
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        <h3 className='font-medium'>专属返佣天数</h3>
        <FormField
          control={form.control}
          name='useDefaultDuration'
          render={({ field }) => (
            <FormItem className='flex items-center gap-2'>
              <FormControl>
                <Checkbox
                  checked={field.value}
                  disabled={save.isPending}
                  onCheckedChange={(checked) => {
                    field.onChange(checked)
                    if (checked) {
                      form.setValue('days', props.globalDurationDays, {
                        shouldValidate: true,
                      })
                    }
                  }}
                />
              </FormControl>
              <FormLabel>
                沿用全局天数（
                {props.globalDurationDays === 0
                  ? '长期'
                  : `${formatNumber(props.globalDurationDays, 'zh-CN')} 天`}
                ）
              </FormLabel>
            </FormItem>
          )}
        />
        {!useDefaultDuration && (
          <FormField
            control={form.control}
            name='days'
            render={({ field }) => (
              <FormItem>
                <FormLabel>返佣天数（0 表示长期）</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    max={36500}
                    step={1}
                    disabled={save.isPending}
                    {...field}
                    value={Number.isFinite(field.value) ? field.value : ''}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === ''
                          ? Number.NaN
                          : Number(event.target.value)
                      )
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        <p className='text-muted-foreground text-sm'>
          仅影响后续充值，历史佣金不变。调整天数不重新计时；从客户注册与伙伴首次获批中较晚的时间起算。比例为
          0% 时不产生新佣金，天数为 0 时长期返佣。
        </p>
        {save.isError && (
          <p role='alert' className='text-destructive text-sm'>
            保存失败，请重试。
          </p>
        )}
        <Button type='submit' disabled={save.isPending}>
          保存返佣设置
        </Button>
      </form>
    </Form>
  )
}
