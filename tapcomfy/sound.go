package tapcomfy

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"slices"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/tcolgate/mp3"
	"github.com/tidwall/gjson"
)

const DefaultElevenLabsSoundVersion = "eleven_text_to_sound_v3"

const ElevenLabsSoundModel = "elevenlabs-sound"

// ElevenLabsSoundRequest retains the public model for authorization and pricing.
// SetModelName changes only the model sent upstream. It carries no token usage:
// the relay measures generated audio separately from this request's ceiling.
type ElevenLabsSoundRequest struct {
	dto.BaseRequest
	Model        string
	VersionModel string
	payload      struct {
		Text            string   `json:"text"`
		ModelID         string   `json:"model_id"`
		DurationSeconds *float64 `json:"duration_seconds,omitempty"`
		PromptInfluence *float64 `json:"prompt_influence,omitempty"`
		Loop            *bool    `json:"loop,omitempty"`
	}
	query url.Values
}

func (r *ElevenLabsSoundRequest) SetModelName(name string) { r.payload.ModelID = name }

// DurationLimitSeconds is the admission ceiling, never a substitute for measured
// generated duration at settlement.
func (r *ElevenLabsSoundRequest) DurationLimitSeconds() float64 {
	if r.payload.DurationSeconds != nil {
		return *r.payload.DurationSeconds
	}
	return 30
}

func (r *ElevenLabsSoundRequest) UpstreamBody() ([]byte, error) {
	return common.Marshal(r.payload)
}

func (r *ElevenLabsSoundRequest) UpstreamPath() string {
	return "/v1/sound-generation?" + r.query.Encode()
}

// ParseElevenLabsSoundRequest must run before channel distribution: its Model is
// the sole public model ID to use for permission, group and price selection.
func ParseElevenLabsSoundRequest(body []byte, rawQuery string) (*ElevenLabsSoundRequest, *types.NewAPIError) {
	invalid := func(message string) (*ElevenLabsSoundRequest, *types.NewAPIError) {
		return nil, types.NewError(errors.New(message), types.ErrorCodeInvalidRequest,
			types.ErrOptionWithStatusCode(http.StatusBadRequest), types.ErrOptionWithSkipRetry())
	}
	var fields map[string]common.RawMessage
	if !utf8.Valid(body) || common.Unmarshal(body, &fields) != nil || fields == nil {
		return invalid("request body must be a JSON object")
	}
	seen := make(map[string]bool, len(fields))
	var invalidField string
	gjson.ParseBytes(body).ForEach(func(key, value gjson.Result) bool {
		name := key.String()
		if seen[name] || !slices.Contains([]string{"text", "model_id", "duration_seconds", "prompt_influence", "loop"}, name) || value.Type == gjson.Null {
			invalidField = "unsupported, duplicate or null sound field: " + name
			return false
		}
		seen[name] = true
		return true
	})
	if invalidField != "" {
		return invalid(invalidField)
	}
	request := &ElevenLabsSoundRequest{}
	if err := common.Unmarshal(body, &request.payload); err != nil {
		return invalid("invalid sound field type")
	}
	if request.payload.Text == "" || utf8.RuneCountInString(request.payload.Text) > 4100 {
		return invalid("text must contain between 1 and 4100 characters")
	}
	if _, present := fields["model_id"]; !present {
		request.payload.ModelID = DefaultElevenLabsSoundVersion
	}
	if request.payload.ModelID != DefaultElevenLabsSoundVersion {
		return invalid("unsupported sound model_id")
	}
	if duration := request.payload.DurationSeconds; duration != nil && (math.IsNaN(*duration) || math.IsInf(*duration, 0) || *duration < 0.5 || *duration > 30) {
		return invalid("duration_seconds must be a finite number between 0.5 and 30")
	}
	if influence := request.payload.PromptInfluence; influence != nil && (math.IsNaN(*influence) || math.IsInf(*influence, 0) || *influence < 0 || *influence > 1) {
		return invalid("prompt_influence must be a finite number between 0 and 1")
	}
	query, err := url.ParseQuery(rawQuery)
	if err != nil {
		return invalid("invalid sound query")
	}
	for name, values := range query {
		if len(values) != 1 {
			return invalid("duplicate sound query parameter: " + name)
		}
		switch name {
		case "output_format":
			if values[0] != "mp3_44100_128" {
				return invalid("output_format must be mp3_44100_128")
			}
		case "enable_logging":
			if values[0] != "true" && values[0] != "false" {
				return invalid("enable_logging must be true or false")
			}
		default:
			return invalid(fmt.Sprintf("unsupported sound query parameter: %s", name))
		}
	}
	if _, present := query["output_format"]; !present {
		query.Set("output_format", "mp3_44100_128")
	}
	request.Model = ElevenLabsSoundModel
	request.VersionModel = request.payload.ModelID
	request.query = query
	return request, nil
}

// soundMP3Duration accepts complete 44.1 kHz MPEG-1 Layer III streams with a
// verified Xing/Info + LAME or FFmpeg Lavf gapless tag. It subtracts encoder
// delay and padding from audio frames (the metadata frame itself has no audio).
// See LAME libmp3lame/VbrTag.c and FFmpeg libavformat/mp3enc.c.
// Both tags store delay/padding and audio/tag CRCs at the same offsets.
// No requested-duration or byte-rate estimate is used when metadata is missing.
// Other encoder/container forms fail closed.
func soundMP3Duration(audio []byte) (float64, error) {
	if len(audio) >= 10 && string(audio[:3]) == "ID3" {
		size := 0
		for _, b := range audio[6:10] {
			if b&0x80 != 0 {
				return 0, errors.New("invalid MP3 ID3 size")
			}
			size = size<<7 | int(b)
		}
		size += 10
		if audio[3] == 4 && audio[5]&0x10 != 0 {
			size += 10
		}
		if size > len(audio) {
			return 0, errors.New("truncated MP3 ID3 tag")
		}
		audio = audio[size:]
	}
	if len(audio) >= 128 && string(audio[len(audio)-128:len(audio)-125]) == "TAG" {
		audio = audio[:len(audio)-128]
	}
	reader := bytes.NewReader(audio)
	decoder := mp3.NewDecoder(reader)
	var frame mp3.Frame
	var first []byte
	frames := 0
	for reader.Len() > 0 {
		offset := len(audio) - reader.Len()
		var skipped int
		if err := decoder.Decode(&frame, &skipped); err != nil || skipped != 0 {
			return 0, errors.New("invalid or truncated MP3 frame")
		}
		if frame.Header().Version() != mp3.MPEG1 || frame.Header().Layer() != mp3.Layer3 || frame.Header().SampleRate() != 44100 || frame.Header().BitRate() != 128000 {
			return 0, errors.New("MP3 does not match mp3_44100_128")
		}
		if frames == 0 {
			first = audio[offset : offset+frame.Size()]
		}
		frames++
	}
	if frames < 2 {
		return 0, errors.New("upstream returned no MP3 audio frames")
	}
	// MPEG-1 side information is 17 bytes for mono, 32 for other modes.
	side := 32
	if first[3]>>6 == 3 {
		side = 17
	}
	position := 4 + side
	if first[1]&1 == 0 {
		position += 2
	}
	if position+16 > len(first) || (string(first[position:position+4]) != "Xing" && string(first[position:position+4]) != "Info") {
		return 0, errors.New("MP3 gapless metadata is required")
	}
	flags := binary.BigEndian.Uint32(first[position+4:])
	if flags&3 != 3 || flags&^uint32(15) != 0 {
		return 0, errors.New("MP3 frame and byte counts are required")
	}
	if binary.BigEndian.Uint32(first[position+8:]) != uint32(frames-1) || binary.BigEndian.Uint32(first[position+12:]) != uint32(len(audio)) {
		return 0, errors.New("MP3 stream does not match its metadata")
	}
	position += 16
	if flags&4 != 0 {
		position += 100
	}
	if flags&8 != 0 {
		position += 4
	}
	if position+36 > len(first) || !slices.Contains([]string{"LAME", "Lavf"}, string(first[position:position+4])) {
		return 0, errors.New("MP3 LAME or Lavf gapless metadata is required")
	}
	tag := first[position : position+36]
	if mp3CRC16(first[:position+34]) != binary.BigEndian.Uint16(tag[34:]) || mp3CRC16(audio[len(first):]) != binary.BigEndian.Uint16(tag[32:]) {
		return 0, errors.New("MP3 checksum mismatch")
	}
	delay := int(tag[21])<<4 | int(tag[22])>>4
	padding := int(tag[22]&15)<<8 | int(tag[23])
	samples := (frames-1)*1152 - delay - padding
	if delay > 3000 || padding > 3000 || samples <= 0 {
		return 0, errors.New("invalid MP3 gapless duration")
	}
	return float64(samples) / 44100, nil
}

func mp3CRC16(data []byte) uint16 {
	var crc uint16
	for _, b := range data {
		crc ^= uint16(b)
		for range 8 {
			if crc&1 != 0 {
				crc = crc>>1 ^ 0xa001
			} else {
				crc >>= 1
			}
		}
	}
	return crc
}
