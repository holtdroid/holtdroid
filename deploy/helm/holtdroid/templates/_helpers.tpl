{{- define "holtdroid.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 50 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "holtdroid.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ include "holtdroid.tag" . | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "holtdroid.selector" -}}
app.kubernetes.io/name: {{ .root.Chart.Name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "holtdroid.tag" -}}
{{- .Values.image.tag | default .Chart.AppVersion -}}
{{- end -}}

{{- define "holtdroid.image" -}}
{{- printf "%s:%s" .Values.image.repository (include "holtdroid.tag" .) -}}
{{- end -}}

{{- define "holtdroid.pod" -}}
{{- with .root.Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
securityContext:
  {{- toYaml .root.Values.podSecurityContext | nindent 2 }}
enableServiceLinks: false
{{- end -}}

{{- define "holtdroid.container" -}}
image: {{ include "holtdroid.image" .root }}
imagePullPolicy: {{ .root.Values.image.pullPolicy }}
securityContext:
  {{- toYaml .root.Values.securityContext | nindent 2 }}
{{- with .root.Values.existingSecret }}
envFrom:
  - secretRef:
      name: {{ . }}
{{- end }}
{{- end -}}

{{- define "holtdroid.telemetry" -}}
{{- $t := .Values.telemetry -}}
{{- $out := dict "tracing" $t.tracing -}}
{{- if $t.metrics.enabled }}
{{- $_ := set $out "metrics" (dict "listen" (printf ":%d" (int $t.metrics.port))) -}}
{{- end }}
{{- toYaml $out -}}
{{- end -}}


{{- define "holtdroid.auditStorePath" -}}
{{- $p := .Values.audit.store.persistence -}}
{{- if eq $p "data" -}}/var/lib/holtdroid/audit/events.jsonl
{{- else if eq $p "volume" -}}/var/lib/holtdroid-audit/events.jsonl
{{- else if ne $p "none" -}}{{ fail "audit.store.persistence must be data, volume or none" }}
{{- end -}}
{{- end -}}

{{- define "holtdroid.audit" -}}
{{- $a := .root.Values.audit -}}
{{- $out := dict "stdout" $a.stdout "otlp" $a.otlp "webhook" $a.webhook -}}
{{- if eq .component "api" -}}
{{- $_ := set $out "store" (dict "enabled" $a.store.enabled "maxEvents" (int $a.store.maxEvents) "maxAge" $a.store.maxAge "path" (include "holtdroid.auditStorePath" .root)) -}}
{{- else -}}
{{- $_ := set $out "forward" $a.store.enabled -}}
{{- end -}}
{{- toYaml $out -}}
{{- end -}}
