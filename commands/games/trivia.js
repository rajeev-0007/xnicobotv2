const { SlashCommandBuilder } = require('discord.js');
const ui = require('../../utils/gamesUI');

const questions = [
    // Geography
    { q: 'What is the capital of France?', a: 'Paris', options: ['London', 'Paris', 'Berlin', 'Madrid'] },
    { q: 'What is the capital of Japan?', a: 'Tokyo', options: ['Osaka', 'Kyoto', 'Tokyo', 'Hiroshima'] },
    { q: 'What is the largest country in the world by area?', a: 'Russia', options: ['Canada', 'China', 'Russia', 'USA'] },
    { q: 'Which continent is the Sahara Desert located on?', a: 'Africa', options: ['Asia', 'Africa', 'Australia', 'South America'] },
    { q: 'What is the longest river in the world?', a: 'Nile', options: ['Amazon', 'Nile', 'Yangtze', 'Mississippi'] },
    { q: 'Which country has the most natural lakes?', a: 'Canada', options: ['Russia', 'Brazil', 'Canada', 'USA'] },
    { q: 'What is the smallest country in the world?', a: 'Vatican City', options: ['Monaco', 'Liechtenstein', 'Vatican City', 'San Marino'] },
    { q: 'Which city is known as the City of Canals?', a: 'Venice', options: ['Amsterdam', 'Venice', 'Bangkok', 'Copenhagen'] },
    { q: 'What is the capital of Australia?', a: 'Canberra', options: ['Sydney', 'Melbourne', 'Canberra', 'Brisbane'] },

    // Science
    { q: 'How many continents are there?', a: '7', options: ['5', '6', '7', '8'] },
    { q: 'What is the largest planet in our solar system?', a: 'Jupiter', options: ['Mars', 'Saturn', 'Jupiter', 'Neptune'] },
    { q: 'What is the chemical symbol for gold?', a: 'Au', options: ['Go', 'Gd', 'Au', 'Ag'] },
    { q: 'How many bones are in the adult human body?', a: '206', options: ['186', '196', '206', '216'] },
    { q: 'What is the hardest natural substance?', a: 'Diamond', options: ['Gold', 'Iron', 'Diamond', 'Platinum'] },
    { q: 'What is the largest ocean on Earth?', a: 'Pacific', options: ['Atlantic', 'Indian', 'Pacific', 'Arctic'] },
    { q: 'What gas do plants absorb from the atmosphere?', a: 'Carbon dioxide', options: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'] },
    { q: 'How many hearts does an octopus have?', a: '3', options: ['1', '2', '3', '4'] },
    { q: 'What element has the atomic number 1?', a: 'Hydrogen', options: ['Helium', 'Hydrogen', 'Oxygen', 'Carbon'] },
    { q: 'What planet is known as the Red Planet?', a: 'Mars', options: ['Venus', 'Mars', 'Jupiter', 'Mercury'] },
    { q: 'What is the powerhouse of the cell?', a: 'Mitochondria', options: ['Nucleus', 'Ribosome', 'Mitochondria', 'Golgi body'] },
    { q: 'How many chromosomes do humans have?', a: '46', options: ['23', '44', '46', '48'] },
    { q: 'What is the chemical formula for water?', a: 'H₂O', options: ['HO', 'H₂O', 'H₂O₂', 'HO₂'] },
    { q: 'How far is the Earth from the Sun (approximately)?', a: '150 million km', options: ['93 million km', '150 million km', '225 million km', '300 million km'] },

    // History
    { q: 'In which year did World War II end?', a: '1945', options: ['1943', '1944', '1945', '1946'] },
    { q: 'Who was the first President of the United States?', a: 'George Washington', options: ['Thomas Jefferson', 'Abraham Lincoln', 'George Washington', 'John Adams'] },
    { q: 'In which year did the Berlin Wall fall?', a: '1989', options: ['1985', '1987', '1989', '1991'] },
    { q: 'Who discovered penicillin?', a: 'Alexander Fleming', options: ['Louis Pasteur', 'Marie Curie', 'Alexander Fleming', 'Edward Jenner'] },
    { q: 'Which empire built the Colosseum?', a: 'Roman', options: ['Greek', 'Roman', 'Ottoman', 'Persian'] },
    { q: 'In which year did humans first land on the moon?', a: '1969', options: ['1965', '1967', '1969', '1972'] },
    { q: 'Who was the first woman to win a Nobel Prize?', a: 'Marie Curie', options: ['Florence Nightingale', 'Marie Curie', 'Ada Lovelace', 'Rosalind Franklin'] },
    { q: 'Which ancient civilization built the pyramids of Giza?', a: 'Egyptians', options: ['Romans', 'Greeks', 'Egyptians', 'Mesopotamians'] },

    // Pop Culture & Arts
    { q: 'Who painted the Mona Lisa?', a: 'Leonardo da Vinci', options: ['Michelangelo', 'Leonardo da Vinci', 'Raphael', 'Donatello'] },
    { q: 'Who wrote "Harry Potter"?', a: 'J.K. Rowling', options: ['J.R.R. Tolkien', 'J.K. Rowling', 'George R.R. Martin', 'C.S. Lewis'] },
    { q: 'How many strings does a standard guitar have?', a: '6', options: ['4', '5', '6', '7'] },
    { q: 'Which band wrote "Bohemian Rhapsody"?', a: 'Queen', options: ['The Beatles', 'Led Zeppelin', 'Queen', 'Pink Floyd'] },
    { q: 'Who wrote Romeo and Juliet?', a: 'Shakespeare', options: ['Dickens', 'Shakespeare', 'Austen', 'Twain'] },
    { q: 'What movie features the song "Let It Go"?', a: 'Frozen', options: ['Tangled', 'Brave', 'Frozen', 'Moana'] },
    { q: 'Who directed "The Dark Knight"?', a: 'Christopher Nolan', options: ['Tim Burton', 'Zack Snyder', 'Christopher Nolan', 'James Cameron'] },
    { q: 'What is the best-selling video game of all time?', a: 'Minecraft', options: ['Tetris', 'GTA V', 'Minecraft', 'Mario Kart 8'] },

    // Math & Logic
    { q: 'What is the smallest prime number?', a: '2', options: ['1', '2', '3', '5'] },
    { q: 'What is 12 × 12?', a: '144', options: ['124', '132', '144', '152'] },
    { q: 'How many sides does a hexagon have?', a: '6', options: ['5', '6', '7', '8'] },
    { q: 'What is the square root of 144?', a: '12', options: ['10', '11', '12', '13'] },
    { q: 'What is pi rounded to 2 decimal places?', a: '3.14', options: ['3.12', '3.13', '3.14', '3.16'] },
    { q: 'What is 15% of 200?', a: '30', options: ['25', '28', '30', '35'] },
    { q: 'How many degrees are in a right angle?', a: '90', options: ['45', '60', '90', '180'] },

    // Food & Nature
    { q: 'What is the main ingredient in guacamole?', a: 'Avocado', options: ['Tomato', 'Avocado', 'Lime', 'Onion'] },
    { q: 'What is the largest land animal?', a: 'African Elephant', options: ['Giraffe', 'Hippopotamus', 'African Elephant', 'Rhinoceros'] },
    { q: 'How many legs does a spider have?', a: '8', options: ['6', '7', '8', '10'] },
    { q: 'What is the fastest land animal?', a: 'Cheetah', options: ['Lion', 'Horse', 'Cheetah', 'Greyhound'] },
    { q: 'What type of animal is a Komodo Dragon?', a: 'Lizard', options: ['Crocodile', 'Dinosaur', 'Lizard', 'Snake'] },
    { q: 'What is the tallest animal in the world?', a: 'Giraffe', options: ['Elephant', 'Giraffe', 'Ostrich', 'Camel'] },

    // Technology
    { q: 'What does CPU stand for?', a: 'Central Processing Unit', options: ['Core Processing Unit', 'Central Processing Unit', 'Computer Power Unit', 'Control Processing Unit'] },
    { q: 'What programming language was created by Guido van Rossum?', a: 'Python', options: ['Java', 'Ruby', 'Python', 'Perl'] },
    { q: 'In what year was the first iPhone released?', a: '2007', options: ['2005', '2006', '2007', '2008'] },
    { q: 'What does HTML stand for?', a: 'HyperText Markup Language', options: ['High Transfer Markup Language', 'HyperText Markup Language', 'HyperText Management Language', 'Home Tool Markup Language'] },
    { q: 'Who founded Microsoft?', a: 'Bill Gates', options: ['Steve Jobs', 'Elon Musk', 'Bill Gates', 'Mark Zuckerberg'] },
    { q: 'What does "GPU" stand for?', a: 'Graphics Processing Unit', options: ['General Processing Unit', 'Graphics Processing Unit', 'Global Processing Unit', 'Game Processing Unit'] },
    { q: 'Which company created the Android operating system?', a: 'Google', options: ['Apple', 'Samsung', 'Google', 'Microsoft'] },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trivia')
        .setDescription('Test your knowledge with a random trivia question!'),

    prefix: 'trivia',
    description: 'Test your knowledge with a random trivia question!',
    usage: 'trivia',
    category: 'games',
    aliases: ['quiz'],

    async execute(interaction) {
        await playTrivia(interaction, true);
    },

    async executePrefix(message) {
        await playTrivia(message, false);
    }
};

async function playTrivia(context, isInteraction) {
    const gid = context.guild?.id;
    const trivia = questions[Math.floor(Math.random() * questions.length)];
    const shuffled = [...trivia.options].sort(() => Math.random() - 0.5);

    const optionLines = shuffled.map((opt, i) => `**${i + 1}.** ${opt}`);

    await context.reply(ui.payload(ui.panel(gid, {
        emoji: '🧠',
        title: 'Trivia Time!',
        body: `**${trivia.q}**\n\n${ui.rows(optionLines)}`,
        note: 'Type your answer (1-4) within 15 seconds!',
    })));

    const channel = context.channel;
    const authorId = isInteraction ? context.user.id : context.author.id;

    const filter = m => m.author.id === authorId && ['1', '2', '3', '4'].includes(m.content.trim());

    try {
        const collected = await channel.awaitMessages({ filter, max: 1, time: 15000, errors: ['time'] });
        const selected = shuffled[parseInt(collected.first().content.trim()) - 1];

        if (selected === trivia.a) {
            await channel.send(ui.payload(ui.ok(gid, 'Correct!', `The answer is **${trivia.a}**!`, `${ui.E.gift} Great job!`)));
        } else {
            await channel.send(ui.payload(ui.err(gid, 'Wrong!', `You answered **${selected}**, but the correct answer was **${trivia.a}**.`, 'Better luck next time!')));
        }
    } catch {
        await channel.send(ui.payload(ui.timeout(gid, "Time's Up!", `The correct answer was **${trivia.a}**.`, 'Type faster next time!')));
    }
}
