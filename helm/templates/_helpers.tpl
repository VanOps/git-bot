{{/*
Nombre completo del release (truncado a 63 chars)
*/}}
{{- define "git-bot.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Nombre del chart
*/}}
{{- define "git-bot.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Etiquetas comunes
*/}}
{{- define "git-bot.labels" -}}
helm.sh/chart: {{ include "git-bot.chart" . }}
{{ include "git-bot.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "git-bot.selectorLabels" -}}
app.kubernetes.io/name: {{ include "git-bot.fullname" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Nombre del Secret a usar (existente o generado por el chart)
*/}}
{{- define "git-bot.secretName" -}}
{{- if .Values.existingSecret }}
{{- .Values.existingSecret }}
{{- else }}
{{- include "git-bot.fullname" . }}-secret
{{- end }}
{{- end }}

{{/*
URL interna del servicio git-bot (usado por Grafana datasource)
*/}}
{{- define "git-bot.serviceUrl" -}}
{{- printf "http://%s:%d" (include "git-bot.fullname" .) (int .Values.service.port) }}
{{- end }}
