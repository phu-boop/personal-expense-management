FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache fontconfig ttf-dejavu
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 5000
CMD ["npm", "run", "start"]
