FROM mcr.microsoft.com/playwright:v1.55.0-noble

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg xvfb \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

CMD ["sh", "-lc", "xvfb-run -a npm run dry-run"]
