FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir uv && uv sync --no-dev
COPY backend ./backend
EXPOSE 8000
CMD ["uv", "run", "fastapi", "run", "backend/app/main.py", "--host", "0.0.0.0"]
