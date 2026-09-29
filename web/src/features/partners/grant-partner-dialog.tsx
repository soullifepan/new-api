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
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  FormLabel,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { searchUsers } from '@/features/users/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { grantPartner } from './api'

const schema = z.object({
  user_id: z.number().int().positive('请选择用户'),
  channels: z.string().max(1000, '推广渠道过长'),
  notes: z.string().max(1000, '补充说明过长'),
  links: z.string().max(1000, '账号链接过长'),
  plan: z.string().max(1000, '推广计划过长'),
  contact: z.string().max(1000, '联系方式过长'),
  evidence: z.string().max(1000, '证明链接过长'),
  review_note: z.string().max(1000, '合作备注过长'),
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
    defaultValues: {
      user_id: 0,
      channels: '',
      links: '',
      plan: '',
      contact: '',
      evidence: '',
      notes: '',
      review_note: '',
    },
  })
  const users = useQuery({
    queryKey: ['partners', 'user-search', search],
    enabled: props.open && search !== '',
    queryFn: async () =>
      requireServerSuccess(
        await searchUsers({ keyword: search, page_size: 20 })
      ).data?.items ?? [],
  })
  const searching = users.isFetching
  const candidates =
    search && !searching && !users.isError ? (users.data ?? []) : []
  const grant = useMutation({
    mutationFn: grantPartner,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['partners'] })
      toast.success('合作伙伴已添加')
      props.onGranted()
      props.onOpenChange(false)
    },
  })
  const runSearch = () => {
    if (!keyword.trim() || grant.isPending || searching) return
    form.setValue('user_id', 0)
    if (search === keyword.trim()) void users.refetch()
    else setSearch(keyword.trim())
  }
  const selectedId = form.watch('user_id')
  const canSubmit = candidates.some(
    (user) => user.id === selectedId && user.status === 1
  )
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!grant.isPending) props.onOpenChange(open)
      }}
      title='添加合作伙伴'
      contentClassName='sm:max-w-md'
    >
      <Form {...form}>
        <form
          className='space-y-4'
          onSubmit={form.handleSubmit((values) => {
            if (canSubmit) grant.mutate(values)
          })}
        >
          <div className='space-y-2'>
            <Label htmlFor='partner-user-search'>搜索用户</Label>
            <div className='flex items-center gap-2'>
              <Input
                id='partner-user-search'
                value={keyword}
                placeholder='输入用户名或用户 ID'
                disabled={grant.isPending}
                onChange={(e) => {
                  setKeyword(e.target.value)
                  setSearch('')
                  form.setValue('user_id', 0)
                  grant.reset()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    runSearch()
                  }
                }}
              />
              <Button
                type='button'
                variant='outline'
                disabled={!keyword.trim() || grant.isPending || searching}
                onClick={runSearch}
              >
                搜索
              </Button>
            </div>
          </div>
          <div
            className='max-h-64 min-h-28 overflow-y-auto rounded-lg border p-2'
            aria-busy={searching}
          >
            {!search && (
              <p className='text-muted-foreground p-3 text-sm'>
                输入用户名或用户 ID，点击搜索。
              </p>
            )}
            {search && searching && (
              <p role='status' className='text-muted-foreground p-3 text-sm'>
                搜索中…
              </p>
            )}
            {search && !searching && users.isError && (
              <div role='alert' className='space-y-2 p-3 text-sm'>
                <p>搜索失败，请重试。</p>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  onClick={() => users.refetch()}
                >
                  重试
                </Button>
              </div>
            )}
            {search &&
              !searching &&
              !users.isError &&
              candidates.length === 0 && (
                <p role='status' className='text-muted-foreground p-3 text-sm'>
                  未找到匹配用户
                </p>
              )}
            <FormField
              control={form.control}
              name='user_id'
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <RadioGroup
                      aria-label='候选用户'
                      value={field.value > 0 ? String(field.value) : ''}
                      onValueChange={(value) => field.onChange(Number(value))}
                      disabled={grant.isPending}
                    >
                      {candidates.map((user) => (
                        <Label
                          key={user.id}
                          htmlFor={`partner-candidate-${user.id}`}
                          className='has-data-[checked]:bg-accent flex cursor-pointer items-center gap-3 rounded-md p-3 has-data-[disabled]:cursor-not-allowed has-data-[disabled]:opacity-50'
                        >
                          <RadioGroupItem
                            id={`partner-candidate-${user.id}`}
                            value={String(user.id)}
                            disabled={user.status !== 1}
                          />
                          <span className='min-w-0 break-all'>
                            {user.username}（ID：{user.id}）
                            {user.status !== 1 && '（已禁用）'}
                          </span>
                        </Label>
                      ))}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <Collapsible>
            <CollapsibleTrigger
              render={<Button type='button' variant='ghost' size='sm' />}
              disabled={grant.isPending}
            >
              补充资料（选填）
            </CollapsibleTrigger>
            <CollapsibleContent className='space-y-3 pt-3'>
              {(
                [
                  [
                    'channels',
                    '推广渠道',
                    '例如：视频号、社群、客户推荐',
                    false,
                  ],
                  ['links', '账号链接', 'https://', false],
                  ['plan', '推广计划', '', true],
                  ['contact', '联系方式', '微信、手机号或邮箱', false],
                  ['evidence', '证明链接', 'https://', false],
                  ['notes', '补充说明', '', true],
                  ['review_note', '合作备注', '', true],
                ] as const
              ).map(([name, label, placeholder, multiline]) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        {multiline ? (
                          <Textarea
                            {...field}
                            placeholder={placeholder}
                            maxLength={1000}
                            disabled={grant.isPending}
                          />
                        ) : (
                          <Input
                            {...field}
                            placeholder={placeholder}
                            maxLength={1000}
                            disabled={grant.isPending}
                          />
                        )}
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
          {grant.isError && (
            <p role='alert' className='text-destructive text-sm'>
              添加失败，请重试。
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
            <Button type='submit' disabled={grant.isPending || !canSubmit}>
              {grant.isPending ? '添加中…' : '确定'}
            </Button>
          </div>
        </form>
      </Form>
    </Dialog>
  )
}
