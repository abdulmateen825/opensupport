import asyncio

import boto3

from backend.app.core.config import settings


def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
        region_name="us-east-1",
    )


def _ensure_bucket(client, bucket: str) -> None:
    try:
        client.head_bucket(Bucket=bucket)
    except Exception:
        client.create_bucket(Bucket=bucket)


async def put_object(key: str, data: bytes, content_type: str) -> None:
    def write():
        client = _client()
        _ensure_bucket(client, settings.s3_bucket)
        client.put_object(Bucket=settings.s3_bucket, Key=key, Body=data, ContentType=content_type)
    await asyncio.to_thread(write)


async def get_object(key: str) -> bytes:
    def read():
        response = _client().get_object(Bucket=settings.s3_bucket, Key=key)
        try:
            return response["Body"].read()
        finally:
            response["Body"].close()
    return await asyncio.to_thread(read)


async def delete_object(key: str) -> None:
    await asyncio.to_thread(_client().delete_object, Bucket=settings.s3_bucket, Key=key)
