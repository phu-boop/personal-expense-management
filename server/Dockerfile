FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache fontconfig freetype ttf-dejavu

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5000

CMD ["npm", "run", "dev"]
