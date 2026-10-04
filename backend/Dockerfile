FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PATH="/app/.venv/bin:$PATH"
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install --no-cache-dir uv==0.12.20 && uv sync --locked --no-dev
COPY backend ./backend
COPY alembic.ini ./
COPY LICENSE ./
RUN useradd --uid 10001 --create-home opensupport && mkdir /app/beat && chown opensupport:opensupport /app/beat
USER opensupport
EXPOSE 8000
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
