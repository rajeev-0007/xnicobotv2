const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildLoadingResponse } = require('../../utils/responseBuilder');

const WEATHER_ICONS = {
    '01d': '☀️', '01n': '🌙', '02d': '⛅', '02n': '☁️',
    '03d': '☁️', '03n': '☁️', '04d': '☁️', '04n': '☁️',
    '09d': '🌧️', '09n': '🌧️', '10d': '🌦️', '10n': '🌧️',
    '11d': '⛈️', '11n': '⛈️', '13d': '❄️', '13n': '❄️',
    '50d': '🌫️', '50n': '🌫️'
};

function windDir(deg) {
    const d = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return d[Math.round(deg / 22.5) % 16];
}

async function getWeather(city) {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
        const data = await res.json();
        if (!data.current_condition) return null;
        const c = data.current_condition[0], loc = data.nearest_area[0];
        return {
            city: loc.areaName[0].value, country: loc.country[0].value, icon: '🌡️',
            desc: c.weatherDesc[0].value, temp: c.temp_C, tempF: c.temp_F,
            feels: c.FeelsLikeC, feelsF: c.FeelsLikeF, humidity: c.humidity,
            wind: c.windspeedKmph, windDirection: c.winddir16Point,
            visibility: c.visibility + ' km', pressure: c.pressure, provider: 'wttr.in'
        };
    }

    const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`);
    const data = await res.json();
    if (data.cod !== 200) return null;

    return {
        city: data.name, country: data.sys.country,
        icon: WEATHER_ICONS[data.weather[0].icon] || '🌡️',
        desc: data.weather[0].description.replace(/\b\w/g, c => c.toUpperCase()),
        temp: data.main.temp.toFixed(1), tempF: (data.main.temp * 9 / 5 + 32).toFixed(1),
        feels: data.main.feels_like.toFixed(1), feelsF: (data.main.feels_like * 9 / 5 + 32).toFixed(1),
        humidity: data.main.humidity, wind: (data.wind.speed * 3.6).toFixed(1),
        windDirection: windDir(data.wind.deg || 0),
        visibility: data.visibility ? (data.visibility / 1000).toFixed(1) + ' km' : 'N/A',
        pressure: data.main.pressure,
        sunrise: data.sys.sunrise ? `<t:${data.sys.sunrise}:t>` : null,
        sunset: data.sys.sunset ? `<t:${data.sys.sunset}:t>` : null,
        provider: 'OpenWeather'
    };
}

function buildCard(w) {
    let c = `# ${w.icon} ${w.city}, ${w.country}\n### ${w.desc}\n\n`;
    c += `**Temperature** ${w.temp}°C / ${w.tempF}°F\n`;
    c += `**Feels Like** ${w.feels}°C / ${w.feelsF}°F\n`;
    c += `**Humidity** ${w.humidity}%\n`;
    c += `**Wind** ${w.wind} km/h ${w.windDirection}\n`;
    c += `**Visibility** ${w.visibility}\n`;
    c += `**Pressure** ${w.pressure} hPa`;
    if (w.sunrise && w.sunset) c += `\n\n**Sunrise** ${w.sunrise}  ·  **Sunset** ${w.sunset}`;
    c += `\n\n-# Powered by ${w.provider}`;
    return new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(c));
}

function errContainer(title, desc) {
    return new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> ${title}\n\n${desc}`));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('weather')
        .setDescription('Get weather information for a city')
        .addStringOption(o => o.setName('city').setDescription('City name').setRequired(true)),
    prefix: 'weather', description: 'Get current weather for any city',
    usage: 'weather <city>', category: 'utility', aliases: ['w'],

    async execute(interaction) {
        await interaction.deferReply();
        await interaction.editReply({
            components: [buildLoadingResponse('Weather', 'Fetching latest weather data...', 'Contacting weather provider and formatting results.')],
            flags: MessageFlags.IsComponentsV2
        });
        try {
            const w = await getWeather(interaction.options.getString('city'));
            if (!w) return interaction.editReply({ components: [errContainer('City Not Found', `Couldn't find weather for **${interaction.options.getString('city')}**.`)], flags: MessageFlags.IsComponentsV2 });
            await interaction.editReply({ components: [buildCard(w)], flags: MessageFlags.IsComponentsV2 });
        } catch (e) {
            console.error('Weather error:', e);
            await interaction.editReply({ components: [errContainer('Weather Error', 'Couldn\'t fetch weather data.')], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        const city = args.join(' ');
        if (!city) return message.reply({ components: [errContainer('Invalid Usage', '**Usage:** `-weather <city>`\n**Example:** `-weather Tokyo`')], flags: MessageFlags.IsComponentsV2 });

        const loadingMsg = await message.reply({
            components: [buildLoadingResponse('Weather', 'Fetching latest weather data...', 'Contacting weather provider and formatting results.')],
            flags: MessageFlags.IsComponentsV2
        });

        try {
            const w = await getWeather(city);
            if (!w) return loadingMsg.edit({ components: [errContainer('City Not Found', `Couldn't find weather for **${city}**.`)], flags: MessageFlags.IsComponentsV2 });
            await loadingMsg.edit({ components: [buildCard(w)], flags: MessageFlags.IsComponentsV2 });
        } catch (e) {
            console.error('Weather error:', e);
            await loadingMsg.edit({ components: [errContainer('Weather Error', 'Couldn\'t fetch weather data.')], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
