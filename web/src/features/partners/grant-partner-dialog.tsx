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
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { searchUsers } from '@/features/users/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { grantPartner } from './api'

const schema = z.object({
  user_id: z.number().int().positive('请选择用户'),
  note: z.string().max(4000, '备注过长'),
})
type GrantForm = z.infer<typeof schema>

export function GrantPartnerDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGranted: () => void
}) {
  const client = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const form = useForm<GrantForm>({
    resolver: zodResolver(schema),
    defaultValues: { user_id: 0, note: '' },
  })
  const users = useQuery({
    queryKey: ['partners', 'user-search', search],
    enabled: props.open && search !== '',
    queryFn: async () =>
      requireServerSuccess(
        await searchUsers({ keyword: search, page_size: 20 })
      ).data?.items ?? [],
  })
  const grant = useMutation({
    mutationFn: grantPartner,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['partners'] })
      toast.success('合作伙伴已开通')
      props.onGranted()
      props.onOpenChange(false)
      form.reset()
      setKeyword('')
      setSearch('')
    },
  })
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!grant.isPending) props.onOpenChange(open)
      }}
      title='开通合作伙伴'
      description='线下沟通确认后，为已有账号开通合作伙伴权限。开通后可在资料中单独设置返佣比例和天数。'
    >
      <div className='mb-4 space-y-2'>
        <Label htmlFor='partner-user-search'>搜索用户</Label>
        <div className='flex gap-2'>
          <Input
            id='partner-user-search'
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder='输入用户名或用户 ID'
            disabled={grant.isPending}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                form.setValue('user_id', 0)
                setSearch(keyword.trim())
              }
            }}
          />
          <Button
            variant='outline'
            disabled={!keyword.trim() || grant.isPending || users.isFetching}
            onClick={() => {
              form.setValue('user_id', 0)
              setSearch(keyword.trim())
              if (keyword.trim() === search) users.refetch()
            }}
          >
            搜索
          </Button>
        </div>
        {users.isFetching && (
          <p className='text-muted-foreground text-sm'>搜索中…</p>
        )}
        {users.isError && (
          <ErrorState title='用户搜索失败' onRetry={() => users.refetch()} />
        )}
      </div>
      <Form {...form}>
        <form
          className='space-y-4'
          onSubmit={form.handleSubmit((values) => grant.mutate(values))}
        >
          <FormField
            control={form.control}
            name='user_id'
            render={({ field }) => (
              <FormItem>
                <FormLabel>选择用户</FormLabel>
                <FormControl>
                  <Combobox
                    options={(users.data ?? []).map((user) => ({
                      value: String(user.id),
                      label: `${user.username}（ID：${user.id}）`,
                      disabled: user.status !== 1,
                    }))}
                    value={field.value > 0 ? String(field.value) : ''}
                    onValueChange={(value) => field.onChange(Number(value))}
                    disabled={grant.isPending || users.isFetching}
                    placeholder='从搜索结果中选择用户'
                    emptyText='暂无可选用户'
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='note'
            render={({ field }) => (
              <FormItem>
                <FormLabel>给伙伴的说明（选填，对伙伴可见）</FormLabel>
                <FormControl>
                  <Textarea {...field} disabled={grant.isPending} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {grant.isError && (
            <p role='alert' className='text-destructive text-sm'>
              开通失败，请检查账号状态后重试。
            </p>
          )}
          <div className='flex justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              disabled={grant.isPending}
              onClick={() => props.onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type='submit'
              disabled={grant.isPending || form.watch('user_id') <= 0}
            >
              {grant.isPending ? '开通中…' : '确认开通'}
            </Button>
          </div>
        </form>
      </Form>
    </Dialog>
  )
}
