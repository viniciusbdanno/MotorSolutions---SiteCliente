#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <ArduinoJson.h>
#include <time.h>
#include <math.h>


// ============================================================================
// CONFIGURACAO DO USUARIO
// ============================================================================

const char* SSID = "Monitoramento";
const char* PASSWORD = "monitora508";

const char* SERVER_URL =
    "http://192.168.1.242:3000/api/sensores";

const float PULSOS_POR_VOLTA = 1.0f;


// ============================================================================
// MMA8452 - VIBRACAO
// ============================================================================

#define MMA_ADDR 0x1C
#define MMA_CTRL_REG1 0x2A
#define MMA_XYZ_DATA_CFG 0x0E
#define MMA_OUT_X_MSB 0x01


// ============================================================================
// AMOSTRAGEM
// ============================================================================

// 200 Hz durante 1 segundo = 200 amostras
const uint16_t TAXA_AMOSTRAGEM_HZ = 200;
const uint16_t QUANTIDADE_AMOSTRAS = 200;

const uint32_t JANELA_RMS_MS = 1000;


// ============================================================================
// TEMPOS
// ============================================================================

const uint32_t JANELA_RPM_MS = 1000;

// ENVIO A CADA 1 SEGUNDO
const uint32_t INTERVALO_ENVIO_MS = 1000;

const uint32_t WIFI_TIMEOUT_MS = 15000;
const uint32_t NTP_TIMEOUT_MS = 5000;

// Timeout HTTP reduzido para evitar travamento longo
const uint32_t HTTP_TIMEOUT_MS = 1000;


// ============================================================================
// PINOS
// ============================================================================

const int PIN_SDA = 21;
const int PIN_SCL = 22;
const int PIN_DS18B20 = 4;
const int PIN_HALL = 27;


// ============================================================================
// NTP
// ============================================================================

const long GMT_OFFSET_SEC = -3L * 3600L;
const int DAYLIGHT_OFFSET_SEC = 0;

const char* NTP_SERVER_1 = "pool.ntp.org";
const char* NTP_SERVER_2 = "time.nist.gov";


// ============================================================================
// CALIBRACAO
// ============================================================================

const float GRAVIDADE_MS2 = 9.80665f;
const uint16_t AMOSTRAS_CALIBRACAO = 200;

float gravidadeX = 0.0f;
float gravidadeY = 0.0f;
float gravidadeZ = GRAVIDADE_MS2;

float offsetX = 0.0f;
float offsetY = 0.0f;
float offsetZ = 0.0f;


// ============================================================================
// OBJETOS
// ============================================================================

OneWire oneWire(PIN_DS18B20);
DallasTemperature ds18b20(&oneWire);


// ============================================================================
// ESTADO
// ============================================================================

bool mmaDisponivel = false;
bool ds18b20Disponivel = false;
bool ntpConfigurado = false;


// ============================================================================
// HALL / RPM
// ============================================================================

volatile uint32_t pulsosHall = 0;

portMUX_TYPE hallMux = portMUX_INITIALIZER_UNLOCKED;


// ============================================================================
// TEMPORIZADORES
// ============================================================================

uint32_t ultimoCalculoRPMMs = 0;
uint32_t ultimoEnvioMs = 0;
uint32_t ultimaTentativaWiFiMs = 0;


// ============================================================================
// PROTOTIPOS
// ============================================================================

void setupWiFi();
void ensureWiFi();

void setupNTP();

bool setupMMA8452();
bool readMMA8452(float& x, float& y, float& z);

void setupHall();
float readRPM();

bool setupDS18B20();
bool readTemperature(float& temperaturaC);

float readVibrationRMS();

String getTimeString();

int sendHTTP(
    const String& hora,
    float temperaturaC,
    float rpm,
    float vibracao
);

void printStatus(
    const String& hora,
    bool temperaturaValida,
    float temperaturaC,
    float rpm,
    float vibracao,
    int httpCode
);


// ============================================================================
// INTERRUPCAO DO HALL
// ============================================================================

void IRAM_ATTR onHallPulse()
{
    portENTER_CRITICAL_ISR(&hallMux);

    pulsosHall++;

    portEXIT_CRITICAL_ISR(&hallMux);
}


// ============================================================================
// SETUP
// ============================================================================

void setup()
{
    Serial.begin(115200);

    delay(300);


    Serial.println();
    Serial.println("=================================");
    Serial.println("    MONITORAMENTO DO MOTOR");
    Serial.println("=================================");


    // --------------------------------------------------
    // I2C
    // --------------------------------------------------

    Wire.begin(PIN_SDA, PIN_SCL);

    Wire.setClock(400000);


    // --------------------------------------------------
    // WIFI
    // --------------------------------------------------

    setupWiFi();


    // --------------------------------------------------
    // NTP
    // --------------------------------------------------

    setupNTP();


    // --------------------------------------------------
    // MMA8452
    // --------------------------------------------------

    mmaDisponivel = setupMMA8452();


    // --------------------------------------------------
    // HALL
    // --------------------------------------------------

    setupHall();


    // --------------------------------------------------
    // DS18B20
    // --------------------------------------------------

    ds18b20Disponivel = setupDS18B20();


    // --------------------------------------------------
    // STATUS
    // --------------------------------------------------

    Serial.println();
    Serial.println("=================================");
    Serial.println("Sistema inicializado.");
    Serial.println("=================================");

    Serial.printf(
        "Janela RMS: %lu ms\n",
        JANELA_RMS_MS
    );

    Serial.printf(
        "Amostragem: %u Hz\n",
        TAXA_AMOSTRAGEM_HZ
    );

    Serial.printf(
        "Amostras RMS: %u\n",
        QUANTIDADE_AMOSTRAS
    );

    Serial.printf(
        "Janela RPM: %lu ms\n",
        JANELA_RPM_MS
    );

    Serial.printf(
        "Intervalo envio: %lu ms\n",
        INTERVALO_ENVIO_MS
    );

    Serial.println("=================================");


    ultimoCalculoRPMMs = millis();
    ultimoEnvioMs = millis();
}


// ============================================================================
// LOOP
// ============================================================================

void loop()
{
    // --------------------------------------------------
    // GARANTE WIFI
    // --------------------------------------------------

    ensureWiFi();


    // --------------------------------------------------
    // EXECUTA A CADA 1 SEGUNDO
    // --------------------------------------------------

    if (millis() - ultimoEnvioMs < INTERVALO_ENVIO_MS)
    {
        delay(2);
        return;
    }


    ultimoEnvioMs = millis();


    // --------------------------------------------------
    // TEMPERATURA
    // --------------------------------------------------

    float temperaturaC = NAN;

    bool temperaturaValida =
        readTemperature(temperaturaC);


    // --------------------------------------------------
    // RPM
    // --------------------------------------------------

    float rpm = readRPM();


    // --------------------------------------------------
    // VIBRACAO RMS
    // --------------------------------------------------

    float vibracao = readVibrationRMS();


    // --------------------------------------------------
    // HORA
    // --------------------------------------------------

    String hora = getTimeString();


    // --------------------------------------------------
    // ENVIO HTTP
    // --------------------------------------------------

    int httpCode = -1000;


    if (temperaturaValida)
    {
        httpCode = sendHTTP(
            hora,
            temperaturaC,
            rpm,
            vibracao
        );
    }


    // --------------------------------------------------
    // TERMINAL
    // --------------------------------------------------

    printStatus(
        hora,
        temperaturaValida,
        temperaturaC,
        rpm,
        vibracao,
        httpCode
    );
}


// ============================================================================
// WIFI
// ============================================================================

void setupWiFi()
{
    WiFi.mode(WIFI_STA);

    WiFi.setAutoReconnect(true);

    WiFi.persistent(false);


    WiFi.begin(
        SSID,
        PASSWORD
    );


    Serial.printf(
        "Conectando ao Wi-Fi %s",
        SSID
    );


    uint32_t inicio = millis();


    while (
        WiFi.status() != WL_CONNECTED &&
        millis() - inicio < WIFI_TIMEOUT_MS
    )
    {
        Serial.print(".");

        delay(500);
    }


    Serial.println();


    if (WiFi.status() == WL_CONNECTED)
    {
        Serial.print(
            "Wi-Fi conectado. IP: "
        );

        Serial.println(
            WiFi.localIP()
        );
    }
    else
    {
        Serial.println(
            "Wi-Fi indisponivel; novas tentativas serao automaticas."
        );
    }
}


// ============================================================================
// RECONEXAO WIFI
// ============================================================================

void ensureWiFi()
{
    if (WiFi.status() == WL_CONNECTED)
    {
        return;
    }


    if (
        millis() - ultimaTentativaWiFiMs >= 5000UL
    )
    {
        ultimaTentativaWiFiMs = millis();


        Serial.println(
            "Wi-Fi desconectado. Tentando reconectar..."
        );


        WiFi.disconnect();

        WiFi.begin(
            SSID,
            PASSWORD
        );
    }
}


// ============================================================================
// NTP
// ============================================================================

void setupNTP()
{
    configTime(
        GMT_OFFSET_SEC,
        DAYLIGHT_OFFSET_SEC,
        NTP_SERVER_1,
        NTP_SERVER_2
    );


    struct tm timeInfo;


    ntpConfigurado =
        getLocalTime(
            &timeInfo,
            NTP_TIMEOUT_MS
        );


    if (ntpConfigurado)
    {
        Serial.println(
            "NTP sincronizado."
        );
    }
    else
    {
        Serial.println(
            "Falha ao sincronizar NTP."
        );
    }
}


// ============================================================================
// MMA8452 - INICIALIZACAO
// ============================================================================

bool setupMMA8452()
{
    Serial.println();
    Serial.println(
        "Inicializando MMA8452 diretamente via I2C..."
    );


    // --------------------------------------------------
    // TESTA ENDERECO
    // --------------------------------------------------

    Wire.beginTransmission(
        MMA_ADDR
    );


    byte erro =
        Wire.endTransmission();


    if (erro != 0)
    {
        Serial.print(
            "ERRO: MMA8452 nao respondeu. Codigo I2C: "
        );

        Serial.println(erro);

        return false;
    }


    Serial.println(
        "MMA8452 encontrado no endereco 0x1C!"
    );


    // --------------------------------------------------
    // STANDBY
    // --------------------------------------------------

    Wire.beginTransmission(
        MMA_ADDR
    );

    Wire.write(
        MMA_CTRL_REG1
    );

    Wire.write(0x00);

    Wire.endTransmission();


    delay(10);


    // --------------------------------------------------
    // +/- 2g
    // --------------------------------------------------

    Wire.beginTransmission(
        MMA_ADDR
    );

    Wire.write(
        MMA_XYZ_DATA_CFG
    );

    Wire.write(0x00);

    Wire.endTransmission();


    delay(10);


    // --------------------------------------------------
    // ACTIVE + 200 Hz
    // --------------------------------------------------

    Wire.beginTransmission(
        MMA_ADDR
    );

    Wire.write(
        MMA_CTRL_REG1
    );

    Wire.write(0x09);

    Wire.endTransmission();


    delay(100);


    // --------------------------------------------------
    // LEITURA DE TESTE
    // --------------------------------------------------

    float testeX;
    float testeY;
    float testeZ;


    if (
        !readMMA8452(
            testeX,
            testeY,
            testeZ
        )
    )
    {
        Serial.println(
            "ERRO: MMA8452 respondeu no I2C, mas a leitura falhou."
        );

        return false;
    }


    Serial.println(
        "Leitura inicial do MMA8452:"
    );

    Serial.print("X = ");
    Serial.println(testeX, 4);

    Serial.print("Y = ");
    Serial.println(testeY, 4);

    Serial.print("Z = ");
    Serial.println(testeZ, 4);


    // --------------------------------------------------
    // CALIBRACAO
    // --------------------------------------------------

    Serial.println();
    Serial.println("=================================");
    Serial.println("            CALIBRACAO");
    Serial.println("=================================");
    Serial.println("NAO MEXA NO SENSOR!");
    Serial.println("Mantenha o motor parado...");
    Serial.println();


    delay(1000);


    float somaX = 0.0f;
    float somaY = 0.0f;
    float somaZ = 0.0f;


    uint16_t amostrasValidas = 0;


    for (
        uint16_t i = 0;
        i < AMOSTRAS_CALIBRACAO;
        i++
    )
    {
        float x;
        float y;
        float z;


        if (
            readMMA8452(
                x,
                y,
                z
            )
        )
        {
            somaX += x;
            somaY += y;
            somaZ += z;

            amostrasValidas++;
        }


        delay(5);
    }


    if (amostrasValidas < 50)
    {
        Serial.println(
            "ERRO: poucas amostras validas na calibracao."
        );

        return false;
    }


    float mediaX =
        somaX / amostrasValidas;

    float mediaY =
        somaY / amostrasValidas;

    float mediaZ =
        somaZ / amostrasValidas;


    Serial.println(
        "Valores medios da calibracao:"
    );

    Serial.print("X = ");
    Serial.println(mediaX, 4);

    Serial.print("Y = ");
    Serial.println(mediaY, 4);

    Serial.print("Z = ");
    Serial.println(mediaZ, 4);


    float modulo =
        sqrtf(
            mediaX * mediaX +
            mediaY * mediaY +
            mediaZ * mediaZ
        );


    if (modulo < 1.0f)
    {
        Serial.println(
            "ERRO: calibracao invalida."
        );

        return false;
    }


    // --------------------------------------------------
    // GRAVIDADE
    // --------------------------------------------------

    gravidadeX =
        (mediaX / modulo) *
        GRAVIDADE_MS2;

    gravidadeY =
        (mediaY / modulo) *
        GRAVIDADE_MS2;

    gravidadeZ =
        (mediaZ / modulo) *
        GRAVIDADE_MS2;


    // --------------------------------------------------
    // OFFSETS
    // --------------------------------------------------

    offsetX =
        mediaX - gravidadeX;

    offsetY =
        mediaY - gravidadeY;

    offsetZ =
        mediaZ - gravidadeZ;


    Serial.println();
    Serial.println(
        "Gravidade utilizada:"
    );

    Serial.print("GX = ");
    Serial.println(gravidadeX, 4);

    Serial.print("GY = ");
    Serial.println(gravidadeY, 4);

    Serial.print("GZ = ");
    Serial.println(gravidadeZ, 4);


    Serial.println();
    Serial.println("Offsets:");

    Serial.print("OX = ");
    Serial.println(offsetX, 4);

    Serial.print("OY = ");
    Serial.println(offsetY, 4);

    Serial.print("OZ = ");
    Serial.println(offsetZ, 4);


    Serial.println();
    Serial.println(
        "MMA8452 pronto para medir vibracao!"
    );

    Serial.println();


    return true;
}


// ============================================================================
// LEITURA MMA8452
// ============================================================================

bool readMMA8452(
    float& x,
    float& y,
    float& z
)
{
    Wire.beginTransmission(
        MMA_ADDR
    );

    Wire.write(
        MMA_OUT_X_MSB
    );


    if (
        Wire.endTransmission(false) != 0
    )
    {
        return false;
    }


    uint8_t recebido =
        Wire.requestFrom(
            MMA_ADDR,
            (uint8_t)6
        );


    if (
        recebido != 6 ||
        Wire.available() < 6
    )
    {
        return false;
    }


    int16_t rawX =
        ((int16_t)Wire.read() << 8) |
        Wire.read();


    int16_t rawY =
        ((int16_t)Wire.read() << 8) |
        Wire.read();


    int16_t rawZ =
        ((int16_t)Wire.read() << 8) |
        Wire.read();


    rawX >>= 2;
    rawY >>= 2;
    rawZ >>= 2;


    // +/-2g = 4096 counts/g

    x =
        ((float)rawX / 4096.0f) *
        GRAVIDADE_MS2;

    y =
        ((float)rawY / 4096.0f) *
        GRAVIDADE_MS2;

    z =
        ((float)rawZ / 4096.0f) *
        GRAVIDADE_MS2;


    return true;
}


// ============================================================================
// HALL
// ============================================================================

void setupHall()
{
    pinMode(
        PIN_HALL,
        INPUT_PULLUP
    );


    attachInterrupt(
        digitalPinToInterrupt(PIN_HALL),
        onHallPulse,
        FALLING
    );


    Serial.println(
        "Sensor Hall configurado."
    );
}


// ============================================================================
// RPM - JANELA DE 1 SEGUNDO
// ============================================================================

float readRPM()
{
    uint32_t agora =
        millis();


    uint32_t janelaMs =
        agora -
        ultimoCalculoRPMMs;


    ultimoCalculoRPMMs =
        agora;


    uint32_t pulsos;


    portENTER_CRITICAL(
        &hallMux
    );


    pulsos =
        pulsosHall;


    pulsosHall =
        0;


    portEXIT_CRITICAL(
        &hallMux
    );


    if (
        janelaMs == 0 ||
        PULSOS_POR_VOLTA <= 0.0f
    )
    {
        return 0.0f;
    }


    return
        (
            pulsos *
            60000.0f
        ) /
        (
            PULSOS_POR_VOLTA *
            janelaMs
        );
}


// ============================================================================
// DS18B20
// ============================================================================

bool setupDS18B20()
{
    ds18b20.begin();

    ds18b20.setResolution(10);


    bool encontrado =
        ds18b20.getDeviceCount() > 0;


    if (encontrado)
    {
        Serial.println(
            "DS18B20 encontrado."
        );
    }
    else
    {
        Serial.println(
            "ERRO: DS18B20 nao encontrado."
        );
    }


    return encontrado;
}


// ============================================================================
// TEMPERATURA
// ============================================================================

bool readTemperature(
    float& temperaturaC
)
{
    if (!ds18b20Disponivel)
    {
        return false;
    }


    ds18b20.requestTemperatures();


    float leitura =
        ds18b20.getTempCByIndex(0);


    if (
        leitura ==
            DEVICE_DISCONNECTED_C ||
        isnan(leitura)
    )
    {
        Serial.println(
            "Aviso: leitura do DS18B20 invalida."
        );

        return false;
    }


    temperaturaC =
        leitura;


    return true;
}


// ============================================================================
// VIBRACAO RMS - 1 SEGUNDO
// ============================================================================

float readVibrationRMS()
{
    if (!mmaDisponivel)
    {
        return NAN;
    }


    double somaQuadrados =
        0.0;


    const uint32_t periodoUs =
        1000000UL /
        TAXA_AMOSTRAGEM_HZ;


    uint16_t amostrasValidas =
        0;


    // --------------------------------------------------
    // 200 AMOSTRAS A 200 Hz
    // = 1 SEGUNDO
    // --------------------------------------------------

    for (
        uint16_t i = 0;
        i < QUANTIDADE_AMOSTRAS;
        i++
    )
    {
        uint32_t inicio =
            micros();


        float x;
        float y;
        float z;


        if (
            readMMA8452(
                x,
                y,
                z
            )
        )
        {
            // Remove gravidade e offset

            float ax =
                x -
                offsetX -
                gravidadeX;


            float ay =
                y -
                offsetY -
                gravidadeY;


            float az =
                z -
                offsetZ -
                gravidadeZ;


            // Magnitude da aceleracao

            float aceleracao =
                sqrtf(
                    ax * ax +
                    ay * ay +
                    az * az
                );


            somaQuadrados +=
                (double)aceleracao *
                (double)aceleracao;


            amostrasValidas++;
        }


        uint32_t gasto =
            micros() -
            inicio;


        if (
            gasto < periodoUs
        )
        {
            delayMicroseconds(
                periodoUs -
                gasto
            );
        }
    }


    if (
        amostrasValidas <
        QUANTIDADE_AMOSTRAS * 0.8f
    )
    {
        Serial.println(
            "ERRO: poucas leituras validas do MMA8452 durante RMS."
        );

        return NAN;
    }


    return sqrtf(
        (float)(
            somaQuadrados /
            amostrasValidas
        )
    );
}


// ============================================================================
// HORA
// ============================================================================

String getTimeString()
{
    struct tm timeInfo;


    if (
        !getLocalTime(
            &timeInfo,
            1000
        )
    )
    {
        ntpConfigurado =
            false;


        return "--:--:--";
    }


    ntpConfigurado =
        true;


    char hora[9];


    strftime(
        hora,
        sizeof(hora),
        "%H:%M:%S",
        &timeInfo
    );


    return String(hora);
}


// ============================================================================
// HTTP
// ============================================================================

int sendHTTP(
    const String& hora,
    float temperaturaC,
    float rpm,
    float vibracao
)
{
    if (
        WiFi.status() !=
        WL_CONNECTED
    )
    {
        return -1;
    }


    if (isnan(vibracao))
    {
        Serial.println(
            "HTTP cancelado: MMA8452 indisponivel."
        );

        return -2;
    }


    StaticJsonDocument<256> json;


    char temperaturaFormatada[16];
    char vibracaoFormatada[16];


    snprintf(
        temperaturaFormatada,
        sizeof(temperaturaFormatada),
        "%.2f",
        temperaturaC
    );


    snprintf(
        vibracaoFormatada,
        sizeof(vibracaoFormatada),
        "%.4f",
        vibracao
    );


    json["hora"] =
        hora;


    json["temperatura"] =
        serialized(
            temperaturaFormatada
        );


    json["rpm"] =
        (int)lroundf(rpm);


    json["vibracao"] =
        serialized(
            vibracaoFormatada
        );


    String payload;


    serializeJson(
        json,
        payload
    );


    HTTPClient http;


    http.setConnectTimeout(
        HTTP_TIMEOUT_MS
    );

    http.setTimeout(
        HTTP_TIMEOUT_MS
    );


    if (
        !http.begin(
            SERVER_URL
        )
    )
    {
        Serial.println(
            "ERRO: URL HTTP invalida."
        );

        return -3;
    }


    http.addHeader(
        "Content-Type",
        "application/json"
    );


    int codigo =
        http.POST(payload);


    if (codigo <= 0)
    {
        Serial.printf(
            "ERRO HTTP: %s\n",
            http.errorToString(
                codigo
            ).c_str()
        );
    }


    http.end();


    return codigo;
}


// ============================================================================
// STATUS
// ============================================================================

void printStatus(
    const String& hora,
    bool temperaturaValida,
    float temperaturaC,
    float rpm,
    float vibracao,
    int httpCode
)
{
    Serial.println(
        "---------------------------------"
    );


    Serial.printf(
        "Hora: %s%s\n",
        hora.c_str(),
        ntpConfigurado
            ? ""
            : " (NTP indisponivel)"
    );


    if (temperaturaValida)
    {
        Serial.printf(
            "Temperatura: %.2f C\n",
            temperaturaC
        );
    }
    else
    {
        Serial.println(
            "Temperatura: indisponivel"
        );
    }


    Serial.printf(
        "RPM: %.0f\n",
        rpm
    );


    if (isnan(vibracao))
    {
        Serial.println(
            "Vibracao RMS: indisponivel"
        );
    }
    else
    {
        Serial.printf(
            "Vibracao RMS: %.4f m/s2\n",
            vibracao
        );
    }


    Serial.printf(
        "WiFi: %s\n",
        WiFi.status() ==
            WL_CONNECTED
            ? "OK"
            : "DESCONECTADO"
    );


    if (httpCode == -1000)
    {
        Serial.println(
            "HTTP: nao enviado (temperatura invalida)"
        );
    }
    else if (httpCode >= 0)
    {
        Serial.printf(
            "HTTP: %d\n",
            httpCode
        );
    }
    else
    {
        Serial.printf(
            "HTTP: falha (%d)\n",
            httpCode
        );
    }


    Serial.println(
        "---------------------------------"
    );
}