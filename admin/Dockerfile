FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
# The nginx:alpine entrypoint (docker-entrypoint.d/20-envsubst-on-templates.sh,
# nginx >= 1.19) runs envsubst over every /etc/nginx/templates/*.template into
# /etc/nginx/conf.d/*.conf at container start. That script builds its envsubst
# variable list from `env | cut -d= -f1` — i.e. only names that are actually
# set as container environment variables get substituted. nginx's own
# unbraced runtime variables ($uri, $host, etc.) are never touched because no
# env var is named "uri"/"host"/etc.; only ${API_ORIGIN} (set via compose
# `environment:`) is substituted here.
EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
