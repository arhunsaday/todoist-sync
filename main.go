package main

import (
	"net/http"
	"os"

	"github.com/joho/godotenv"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func main() {
	log.Info().Msg("Hello, World!")

	todoistToken := os.Getenv("TODOIST_API_TOKEN")
	log.Info().Str("todoist_token", todoistToken).Msg("Loaded Todoist API token")

	resp, err := http.Get("http://jeusto.com")
	if err != nil {
		log.Error().Err(err).Msg("Failed to make HTTP request")
		return
	}

	log.Info().Int("status_code", resp.StatusCode).Msg("HTTP request successful")
	resp.Body.Close()
}

func init() {
	initLogger()
	initEnv()
}

func initLogger() {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	zerolog.SetGlobalLevel(zerolog.DebugLevel)
	zerlogOutput := zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: "15:04:05"}
	log.Logger = log.Output(zerlogOutput)
}

func initEnv() {
	if err := godotenv.Load(); err != nil {
		log.Warn().Err(err).Msg("Failed to load .env file")
	}
}
