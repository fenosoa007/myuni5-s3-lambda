const AWS = require('aws-sdk')
const moment = require('moment')
const Multipart = require('lambda-multipart')
const qs = require('node:querystring')
if (!AWS.config.region) {
  AWS.config.update({
    region: 'ap-southeast-2',
  })
}

const dependencies = {
  DynamoDBClient: new AWS.DynamoDB.DocumentClient(),
  TableName: process.env.TABLE_NAME,
  LoginURL: process.env.LOGIN_URL,
  S3Client: new AWS.S3(),
}

const BannerIDColumn = 'BannerID'
const BannerTypeColumn = 'BannerType'
const ImageColumn = 'Image'
const TitleColumn = 'Title'
const SubtitleColumn = 'Subtitle'
const BodyColumn = 'Body'
const LinkColumn = 'Link'
const ScreenColumn = 'Screen'
const CreatedColumn = 'Created'

const post = async (event) => {
  if (event.httpMethod == 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Headers':
          'Content-Type,X-Amz-Date,X-Amz-Security-Token,x-api-key,Authorization,Origin,Host,X-Requested-With,Accept,Access-Control-Allow-Methods,Access-Control-Allow-Origin,Access-Control-Allow-Headers',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods':
          'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
        'X-Requested-With': '*',
      },
    }
  }
  console.log({ event })
  let postData
  if (event.body !== null && event.body !== undefined) {
    console.log('Event ')
    if (event.isBase64Encoded) {
      var buff = Buffer.from(event.body, 'base64').toString('utf-8')
      var conType =
        event.headers['Content-Type'] || event.headers['content-type']
      switch (conType) {
        case 'application/x-www-form-urlencoded':
          postData = qs.parse(buff)
          break
        case 'application/json':
          postData = JSON.parse(buff)
          break
        default:
          postData = JSON.parse(buff)
          if (conType.indexOf('multipart/form-data') > -1) {
            event.body = buff
            event.isBase64Encoded = false
            return upload(event)
          }
          break
      }
      console.log({ postData })
    } else {
      postData = JSON.parse(event.body)
    }
  }
  const { id, type, image, title, subtitle, body, link, screen } = postData
  const created = moment().format('YYYY-MM-DD HH:MM:SS').toString()
  const { TableName, DynamoDBClient } = dependencies
  let data
  let key
  console.log('postData', { postData })
  if (image.indexOf('data:image') > -1) {
    let contentType = image.slice(5, image.indexOf(';base64,'))
    let ext
    switch (contentType) {
      case 'image/png':
        ext = 'png'
        break
      case 'image/jpg':
      case 'image/jpeg':
        ext = 'jpg'
        break
      case 'image/svg+xml':
      case 'image/svg':
        ext = 'svg'
        break
      default:
        ext = contentType.slice(6)
    }
    key = `${new Date().getTime()}.${ext}`
    const s3Params = {
      Bucket: process.env.UploadBucket,
      Key: key,
      Body: Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), "base64")
    }
    console.log({ s3Params })
    const { S3Client } = dependencies
    data = await S3Client.upload(s3Params).promise()
  }
  const params = {
    TableName,
    Item: {
      [BannerIDColumn]: key,
      [BannerTypeColumn]: type,
      [ImageColumn]: data ? data.Location : image,
      [TitleColumn]: title,
      [SubtitleColumn]: subtitle,
      [BodyColumn]: body,
      [LinkColumn]: key ? `https://${process.env.CLOUDFRONT_URL}/${key}` : link,
      [ScreenColumn]: screen,
      [CreatedColumn]: created,
    },
  }
  try {
    await DynamoDBClient.put(params).promise()
    console.log('putBanner', params.Item)

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Headers':
          'Content-Type,X-Amz-Date,X-Amz-Security-Token,x-api-key,Authorization,Origin,Host,X-Requested-With,Accept,Access-Control-Allow-Methods,Access-Control-Allow-Origin,Access-Control-Allow-Headers',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods':
          'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
        'X-Requested-With': '*',
      },
      body: JSON.stringify(params.Item),
    }
  } catch (error) {
    const stack = JSON.stringify(error, null, 2)
    console.error('putBanner', params, stack)
    return {
      headers: {
        'Access-Control-Allow-Headers':
          'Content-Type,X-Amz-Date,X-Amz-Security-Token,x-api-key,Authorization,Origin,Host,X-Requested-With,Accept,Access-Control-Allow-Methods,Access-Control-Allow-Origin,Access-Control-Allow-Headers',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods':
          'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
        'X-Requested-With': '*',
      },
      statusCode: 500,
      message: stack,
    }
  }
}

const parseMultipartFormData = async (event) => {
  console.log({ event })
  return new Promise((resolve, reject) => {
    const parser = new Multipart(event)

    parser.on('finish', (result) => {
      console.log({ result })
      resolve({ fields: result.fields, files: result.files })
    })

    parser.on('error', (error) => {
      return reject(error)
    })
  })
}
const getFileExtension = (file) => {
  console.log({ file })
  const headers = file['headers']
  if (headers == null) {
    throw new Error(`Missing "headers" from request`)
  }

  const contentType = headers['content-type']
  if (contentType == 'image/jpeg') {
    return { ext: 'jpg', type: contentType }
  }
  if (contentType == 'image/png') {
    return { ext: 'png', type: contentType }
  }
  if (contentType == 'image/svg+xml') {
    return { ext: 'svg', type: contentType }
  }

  throw new Error(`Unsupported content type "${contentType}".`)
}
async function uploadFileIntoS3(file) {
  const newDate = new Date().getTime()
  console.log(file)
  const fileInfo = getFileExtension(file)
  const params = {
    Bucket: process.env.UploadBucket,
    Key: `${newDate}.${fileInfo.ext}`,
    Body: file,
    ContentType: file['headers']['content-type'],
  }
  console.log({ params })
  const { S3Client } = dependencies
  const data = await S3Client.upload(params).promise()
  return { data, key: params.Key, type: fileInfo.type }
}

const upload = async (event) => {
  try {
    const { fields, files } = await parseMultipartFormData(event)
    const { TableName, DynamoDBClient } = dependencies
    console.log({ fields }, files)
    const { id, type, image, title, subtitle, body, link, screen } = fields
    const created = moment().format('YYYY-MM-DD HH:MM:SS').toString()
    const imageInfo = await uploadFileIntoS3(files[0])
    const params = {
      TableName,
      Item: {
        [BannerIDColumn]: imageInfo.key,
        [BannerTypeColumn]: imageInfo.type,
        [ImageColumn]: imageInfo.data.Location,
        [TitleColumn]: title,
        [SubtitleColumn]: subtitle,
        [BodyColumn]: body,
        [LinkColumn]: link,
        [ScreenColumn]: screen,
        [CreatedColumn]: created,
      },
    }
    const doc = await DynamoDBClient.put(params).promise()
    console.log({ doc }, process.env.CLOUDFRONT_URL)
    console.log('putBanner', {
      ...params.Item,
      link: 'https://' + process.env.CLOUDFRONT_URL + '/' + imageInfo.key,
    })
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Headers':
          'Content-Type,X-Amz-Date,X-Amz-Security-Token,x-api-key,Authorization,Origin,Host,X-Requested-With,Accept,Access-Control-Allow-Methods,Access-Control-Allow-Origin,Access-Control-Allow-Headers',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods':
          'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
        'X-Requested-With': '*',
      },
      body: JSON.stringify({
        ...params.Item,
        Link: 'https://' + process.env.CLOUDFRONT_URL + '/' + imageInfo.key,
      }),
    }
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify(e.stack),
    }
  }
}

const createS3Bucket = async (event, context) => {
  console.log(event.body)
  const { bucket } = JSON.parse(event.body)
  const { S3Client } = dependencies
  var data = await S3Client.listBuckets().promise()
  console.log(data.Buckets)
  console.log({ bucket }, 123456)
  const isExist = data.Buckets.find((b) => b.Name == bucket)
  console.log({ isExist })
  var newBucket = null
  try {
    newBucket = await S3Client.createBucket({ Bucket: bucket }).promise()
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: e.stack,
      }),
    }
  }
  return {
    statusCode: 200,
    body: JSON.stringify({
      bucket,
      newBucket,
      data: data.Buckets,
    }),
  }
}
module.exports = {
  dependencies,
  upload,
  post,
  createS3Bucket,
}
