# 1. Usa l'immagine ufficiale leggera di Node
FROM node:22-alpine

# Aggiorna il sistema operativo Alpine per risolvere le vulnerabilità (CVE)
RUN apk update && apk upgrade --no-cache

# 2. Imposta la cartella di lavoro nel container
WORKDIR /app

# 3. Copia solo i file dei pacchetti
COPY package*.json ./

# 4. Installa le dipendenze (incluse quelle di sviluppo come typescript e tsc)
RUN npm install

# 5. Copia tutto il resto del codice del backend (escludendo dist grazie al .dockerignore)
COPY . .

# 🔥 FONDAMENTALE: Compila i file .ts e genera la cartella /app/dist/
RUN npm run build

# 6. Esponi la porta del backend Express
EXPOSE 4000

# 7. Comando per avviare il server backend di produzione
CMD ["npm", "run", "start"]