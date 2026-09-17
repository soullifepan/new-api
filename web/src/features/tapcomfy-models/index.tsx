/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState, type ChangeEvent } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { handleServerError } from '@/lib/handle-server-error'

import {
  createTapComfyModel,
  deleteTapComfyModel,
  listTapComfyModels,
  updateTapComfyModel,
  uploadTapComfyAsset,
} from './api'
import { modelFormSchema, type ModelFormValues } from './form-schema'
import type { TapComfyModel, UploadedTapComfyAsset } from './types'

const modelExtensions = new Set(['glb', 'gltf', 'fbx', 'obj'])
const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp'])

const defaultValues: ModelFormValues = {
  name: '',
  category: '',
  thumbnail_url: '',
  thumbnail_object_key: '',
  model_url: '',
  model_object_key: '',
  format: 'glb',
  file_size: 1,
  sort: 0,
  status: 'hidden',
}

function fileExtension(file: File) {
  return file.name.split('.').pop()?.toLowerCase() ?? ''
}

function validateUpload(
  file: File,
  assetType: UploadedTapComfyAsset['assetType']
) {
  const extensions =
    assetType === '3d-model' ? modelExtensions : imageExtensions
  const maxBytes =
    assetType === '3d-model' ? 100 * 1024 * 1024 : 10 * 1024 * 1024
  return (
    extensions.has(fileExtension(file)) &&
    file.size > 0 &&
    file.size <= maxBytes
  )
}

export function TapComfyModels() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<TapComfyModel | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<TapComfyModel | null>(null)
  const modelsQuery = useQuery({
    queryKey: ['tapcomfy-models'],
    queryFn: listTapComfyModels,
  })
  const form = useForm<ModelFormValues>({
    resolver: zodResolver(modelFormSchema),
    defaultValues,
  })
  const saveMutation = useMutation({
    mutationFn: (values: ModelFormValues) =>
      editing
        ? updateTapComfyModel(editing.id, values)
        : createTapComfyModel(values),
    onSuccess: () => {
      toast.success(t('TapComfy 3D model saved'))
      queryClient.invalidateQueries({ queryKey: ['tapcomfy-models'] })
      setDialogOpen(false)
    },
    onError: (error) =>
      handleServerError(error, t('Unable to save TapComfy 3D model')),
  })
  const deleteMutation = useMutation({
    mutationFn: deleteTapComfyModel,
    onSuccess: () => {
      toast.success(t('TapComfy 3D model deleted'))
      queryClient.invalidateQueries({ queryKey: ['tapcomfy-models'] })
      setDeleteTarget(null)
    },
    onError: (error) =>
      handleServerError(error, t('Unable to delete TapComfy 3D model')),
  })

  const openForm = useCallback(
    (item?: TapComfyModel) => {
      setEditing(item ?? null)
      form.reset(
        item
          ? {
              name: item.name,
              category: item.category,
              thumbnail_url: item.thumbnail_url,
              thumbnail_object_key: item.thumbnail_object_key,
              model_url: item.model_url,
              model_object_key: item.model_object_key,
              format: item.format.toLowerCase() as ModelFormValues['format'],
              file_size: item.file_size,
              sort: item.sort,
              status: item.status,
            }
          : defaultValues
      )
      setDialogOpen(true)
    },
    [form]
  )
  const columns = useMemo<ColumnDef<TapComfyModel>[]>(
    () => [
      { accessorKey: 'name', header: t('Name') },
      { accessorKey: 'category', header: t('Category') },
      { accessorKey: 'format', header: t('Format') },
      {
        accessorKey: 'status',
        header: t('Status'),
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.status === 'published' ? 'default' : 'secondary'
            }
          >
            {row.original.status === 'published' ? t('Published') : t('Hidden')}
          </Badge>
        ),
      },
      { accessorKey: 'sort', header: t('Sort') },
      {
        id: 'actions',
        header: t('Actions'),
        cell: ({ row }) => (
          <div className='flex gap-1'>
            <Button
              size='icon-sm'
              variant='ghost'
              aria-label={t('Edit')}
              onClick={() => openForm(row.original)}
            >
              <Pencil />
            </Button>
            <Button
              size='icon-sm'
              variant='ghost'
              aria-label={t('Delete')}
              onClick={() => setDeleteTarget(row.original)}
            >
              <Trash2 className='text-destructive' />
            </Button>
          </div>
        ),
      },
    ],
    [t, openForm]
  )
  const { table } = useDataTable({
    data: modelsQuery.data ?? [],
    columns,
    getRowId: (row) => row.id,
  })

  const upload = async (
    event: ChangeEvent<HTMLInputElement>,
    assetType: UploadedTapComfyAsset['assetType']
  ) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!validateUpload(file, assetType)) {
      form.setError(assetType === '3d-model' ? 'model_url' : 'thumbnail_url', {
        message: t('Unsupported file type or file is too large'),
      })
      event.target.value = ''
      return
    }
    try {
      const asset = await uploadTapComfyAsset(file, assetType)
      if (assetType === '3d-model') {
        form.setValue('model_url', asset.url, { shouldValidate: true })
        form.setValue('model_object_key', asset.objectKey, {
          shouldValidate: true,
        })
        form.setValue('file_size', file.size, { shouldValidate: true })
        form.setValue(
          'format',
          fileExtension(file) as ModelFormValues['format']
        )
      } else {
        form.setValue('thumbnail_url', asset.url, { shouldValidate: true })
        form.setValue('thumbnail_object_key', asset.objectKey, {
          shouldValidate: true,
        })
      }
    } catch (error) {
      handleServerError(error, t('Unable to upload TapComfy asset'))
    } finally {
      event.target.value = ''
    }
  }

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('TapComfy 3D Models')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button onClick={() => openForm()}>
            <Plus />
            {t('Create model')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <DataTablePage
            table={table}
            columns={columns}
            isLoading={modelsQuery.isLoading}
            isFetching={modelsQuery.isFetching}
            emptyTitle={t('No TapComfy 3D models found')}
            emptyDescription={t(
              'Create a 3D model preset to make it available to TapComfy.'
            )}
            skeletonKeyPrefix='tapcomfy-models'
          />
        </SectionPageLayout.Content>
      </SectionPageLayout>
      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={
          editing ? t('Edit TapComfy 3D model') : t('Create TapComfy 3D model')
        }
        footer={
          <Button
            form='tapcomfy-model-form'
            type='submit'
            disabled={saveMutation.isPending}
          >
            {t('Save')}
          </Button>
        }
      >
        <Form {...form}>
          <form
            id='tapcomfy-model-form'
            className='grid gap-3 sm:grid-cols-2'
            onSubmit={form.handleSubmit((values) =>
              saveMutation.mutate(values)
            )}
          >
            {(['name', 'category'] as const).map((name) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t(name === 'name' ? 'Name' : 'Category')}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <FormField
              control={form.control}
              name='sort'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Sort')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      {...field}
                      value={field.value}
                      onChange={(event) =>
                        field.onChange(Number(event.target.value))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='status'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Status')}</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className='w-full'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='published'>
                          {t('Published')}
                        </SelectItem>
                        <SelectItem value='hidden'>{t('Hidden')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormItem>
              <FormLabel>3D 模型文件</FormLabel>
              <Input
                type='file'
                accept='.glb,.gltf,.fbx,.obj'
                onChange={(event) => upload(event, '3d-model')}
              />
              <FormMessage>
                {form.formState.errors.model_url?.message}
              </FormMessage>
            </FormItem>
            <FormItem>
              <FormLabel>{t('Thumbnail image')}</FormLabel>
              <Input
                type='file'
                accept='.png,.jpg,.jpeg,.webp'
                onChange={(event) => upload(event, '3d-thumbnail')}
              />
              <FormMessage>
                {form.formState.errors.thumbnail_url?.message}
              </FormMessage>
            </FormItem>
          </form>
        </Form>
      </Dialog>
      <ConfirmDialog
        destructive
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('Delete TapComfy 3D model?')}
        desc={t(
          'This only deletes the catalogue metadata. Uploaded files are not removed.'
        )}
        confirmText={t('Delete')}
        isLoading={deleteMutation.isPending}
        handleConfirm={() =>
          deleteTarget && deleteMutation.mutate(deleteTarget.id)
        }
      />
    </>
  )
}
