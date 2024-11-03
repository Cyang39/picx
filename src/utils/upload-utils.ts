import { UploadedImageModel, UserConfigInfoModel, UploadImageModel } from '@/common/model'
import { store } from '@/stores'
import {
  createCommit,
  createRef,
  createTree,
  uploadSingleImage,
  getFileBlob,
  getBranchInfo
} from '@/common/api'
import { PICX_UPLOAD_IMG_DESC } from '@/common/constant'
import i18n from '@/plugins/vue/i18n'
import request from '@/utils/request'

/**
 * 图片上传成功之后的处理
 * @param res
 * @param img
 * @param userConfigInfo
 */
const uploadedHandle = (
  res: { name: string; sha: string; path: string; size: number },
  img: UploadImageModel,
  userConfigInfo: UserConfigInfoModel | null = null
) => {
  let dir = userConfigInfo?.selectedDir || localStorage.getItem('alist-path') || '/'

  if (img?.reUploadInfo?.isReUpload) {
    dir = img.reUploadInfo.dir
  }

  // 上传状态处理
  img.uploadStatus.progress = 100
  img.uploadStatus.uploading = false

  const uploadedImg: UploadedImageModel = {
    checked: false,
    type: 'image',
    uuid: img.uuid,
    dir,
    name: res.name,
    sha: res.sha,
    path: res.path,
    deleting: false,
    size: res.size,
    deployed: true
  }

  img.uploadedImg = uploadedImg

  // dirImageList 增加目录
  store.dispatch('DIR_IMAGE_LIST_ADD_DIR', dir)

  // dirImageList 增加图片
  store.dispatch('DIR_IMAGE_LIST_ADD_IMAGE', uploadedImg)
}

/**
 * 上传图片的 URL 处理
 * @param config
 * @param imgObj
 */
export const uploadUrlHandle = (config: UserConfigInfoModel, imgObj: UploadImageModel): string => {
  const { owner, repo, selectedDir: dir } = config
  const filename: string = imgObj.filename.final

  let path = filename

  if (dir !== '/') {
    path = `${dir}/${filename}`
  }

  if (imgObj?.reUploadInfo?.isReUpload) {
    path = imgObj.reUploadInfo.path
  }

  return `/repos/${owner}/${repo}/contents/${path}`
}

/**
 * 上传多张图片到 GitHub 仓库
 * @param userConfigInfo
 * @param imgs
 */
export async function uploadImagesToGitHub(
  userConfigInfo: UserConfigInfoModel,
  imgs: UploadImageModel[]
): Promise<boolean> {
  const { branch, repo, selectedDir, owner } = userConfigInfo

  const blobs = []
  // eslint-disable-next-line no-restricted-syntax
  for (const img of imgs) {
    img.uploadStatus.uploading = true
    const tempBase64 = (
      img.base64.compressBase64 ||
      img.base64.watermarkBase64 ||
      img.base64.originalBase64
    ).split(',')[1]
    // 上传图片文件，为仓库创建 blobs
    const blobRes = await getFileBlob(tempBase64, owner, repo)
    if (blobRes) {
      blobs.push({ img, ...blobRes })
    } else {
      img.uploadStatus.uploading = false
      ElMessage.error(i18n.global.t('upload_page.tip_11', { name: img.filename.final }))
    }
  }

  // 获取 head，用于获取当前分支信息（根目录的 tree sha 以及 head commit sha）
  const branchRes: any = await getBranchInfo(owner, repo, branch)
  if (!branchRes) {
    return Promise.resolve(false)
  }

  const finalPath = selectedDir === '/' ? '' : `${selectedDir}/`

  // 创建 tree
  const treeRes = await createTree(
    owner,
    repo,
    blobs.map((x: any) => ({
      sha: x.sha,
      path: `${finalPath}${x.img.filename.final}`
    })),
    branchRes
  )
  if (!treeRes) {
    return Promise.resolve(false)
  }

  // 创建 commit 节点
  const commitRes: any = await createCommit(owner, repo, treeRes, branchRes)
  if (!commitRes) {
    return Promise.resolve(false)
  }

  // 将当前分支 ref 指向新创建的 commit
  const refRes = await createRef(owner, repo, branch, commitRes.sha)
  if (!refRes) {
    return Promise.resolve(false)
  }

  blobs.forEach((blob: any) => {
    const name = blob.img.filename.final
    uploadedHandle(
      { name, sha: blob.sha, path: `${finalPath}${name}`, size: 0 },
      blob.img,
      userConfigInfo
    )
  })
  return Promise.resolve(true)
}

/**
 * 上传一张图片到 GitHub 仓库
 * @param userConfigInfo
 * @param img
 */
export function uploadImageToGitHub(
  userConfigInfo: UserConfigInfoModel,
  img: UploadImageModel
): Promise<Boolean> {
  const { branch, email, owner } = userConfigInfo

  const data: any = {
    message: PICX_UPLOAD_IMG_DESC,
    branch,
    content: (
      img.base64.compressBase64 ||
      img.base64.watermarkBase64 ||
      img.base64.originalBase64
    ).split(',')[1]
  }

  if (email) {
    data.committer = {
      name: owner,
      email
    }
  }

  img.uploadStatus.uploading = true

  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve) => {
    const uploadRes = await uploadSingleImage(uploadUrlHandle(userConfigInfo, img), data)
    console.log('uploadSingleImage >> ', uploadRes)
    img.uploadStatus.uploading = false
    if (uploadRes) {
      const { name, sha, path, size } = uploadRes.content
      uploadedHandle({ name, sha, path, size }, img, userConfigInfo)
      resolve(true)
    } else {
      resolve(false)
    }
  })
}

// return a promise that resolves with a File instance
function urltoFile(url: any, filename: any, mimeType: any = null) {
  if (url.startsWith('data:')) {
    const arr = url.split(',')
    const mime = arr[0].match(/:(.*?);/)[1]
    const bstr = atob(arr[arr.length - 1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n) {
      n -= 1
      u8arr[n] = bstr.charCodeAt(n)
    }
    const file = new File([u8arr], filename, { type: mime || mimeType })
    return Promise.resolve(file)
  }
  return fetch(url)
    .then((res) => res.arrayBuffer())
    .then((buf) => new File([buf], filename, { type: mimeType }))
}

export function uploadImageToAlist(img: UploadImageModel): Promise<Boolean> {
  const alist_config = {
    server: localStorage.getItem('alist-server'),
    username: localStorage.getItem('alist-username'),
    password: localStorage.getItem('alist-password'),
    path: localStorage.getItem('alist-path')
  }
  if (alist_config.path && alist_config.path[alist_config.path.length - 1] !== '/') {
    alist_config.path += '/'
  }
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve) => {
    const file = await urltoFile(
      img.base64.compressBase64 || img.base64.watermarkBase64 || img.base64.originalBase64,
      img.filename.final
    )
    console.log('file >> ', file)
    if (file) {
      const tokenRes = await request({
        url: `${alist_config.server}/api/auth/login`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        data: {
          username: alist_config.username,
          password: alist_config.password
        }
      })
      const { token } = tokenRes.data
      console.log('token >> ', token)
      const formData = new FormData()
      formData.append('file', file)
      const res = await request({
        url: `${alist_config.server}/api/fs/put`,
        method: 'PUT',
        headers: {
          Authorization: token,
          'Content-Type': 'application/octet-stream',
          'Content-Length': file.size,
          'File-Path': alist_config.path + img.filename.final,
          'Ask-Task': 'true'
        },
        data: file
      })
      console.log('uploadSingleImage >> ', res)
      if (res) {
        uploadedHandle(
          {
            name: img.filename.final,
            sha: '',
            path: alist_config.path + img.filename.final,
            size: file.size
          },
          img
        )
        resolve(true)
      } else {
        resolve(false)
      }
    } else {
      resolve(false)
    }
  })
}
