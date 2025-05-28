/* eslint-disable no-await-in-loop */
import { createWriteStream } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { fromURL } from 'cheerio';
import { format } from '@fast-csv/format';

interface Person {
    id: string;
    name: string;
    image: string;
    url: string;
    position: string;
    bio: string;
    keywords: Set<string>;
    region: string[];
}

function stringify(person: Person): Record<string, string> {
    return {
        id: person.id,
        name: person.name,
        image: person.image,
        url: person.url,
        position: person.position,
        bio: person.bio,
        keywords: Array.from(person.keywords).join(', '),
        region: person.region.join(', '),
    };
}

async function getRegions(url: URL): Promise<Record<string, string>> {
    const $ = await fromURL(url);
    const regions: Record<string, string> = {};
    regions['https://er.ru/'] = 'ЦИК';
    const links = $('.region__list a');
    links.each((_, el) => {
        const regionName = $(el).text().trim();
        const regionUrl = new URL(el.attribs.href ?? '', url).href;
        regions[regionUrl] = regionName;
    });

    return regions;
}

async function getPaths(base: URL): Promise<string[]> {
    const $ = await fromURL(base);
    const paths = new Set<string>();
    const links = $('a[href*="/persons/"]');
    links.each((_, el) => {
        const url = new URL(el.attribs.href ?? '', base);
        if (url.pathname.startsWith('/persons/')) {
            paths.add(url.href);
        }
    });

    return Array.from(paths);
}

async function getPersonsUrls(base: URL): Promise<Record<string, string[]>> {
    const personsUrl = base;
    personsUrl.pathname = '/persons/';
    const paths = await getPaths(base);

    const result: Record<string, string[]> = {};

    for (const path of paths) {
        const url = new URL(path, base);
        const $ = await fromURL(url);
        const keyword = $('.title__inner > h1').text().trim();
        const persons = $('a[href^="/person/"]');
        persons.each((_, el) => {
            const personUrl = new URL(el.attribs.href ?? '', base).href;
            if (result[personUrl]) {
                if (!result[personUrl].includes(keyword)) {
                    result[personUrl].push(keyword);
                }
            } else {
                result[personUrl] = [keyword];
            }
        });
    }

    return result;
}

async function parsePerson(url: URL): Promise<Person> {
    const $ = await fromURL(url);
    const name = $('div.title > h1').text().trim();
    let image = $('div.info .info__img-box img').attr('src') ?? '';
    let position = $('.info__box .info__text').text().trim();
    let bio = $('.typography__container').text().trim();

    if (image.includes('/img/stubs/')) {
        image = '';
    }

    position = position.replace(/\s+/gu, ' ').trim();
    bio = bio
        .replace(/[\s--\n]+/gv, ' ')
        .replace(/\n+/gu, '\n')
        // eslint-disable-next-line sonarjs/slow-regex -- false positive
        .replace(/(?:^\s+)|(?:\s+$)/gmu, '')
        .trim();

    return {
        id: '',
        name,
        image,
        url: url.href,
        position,
        bio,
        keywords: new Set<string>(),
        region: [],
    };
}

const processedPersons: Record<string, Person> = {};

const tmpStream = format({ includeEndRowDelimiter: true, headers: true });
tmpStream.pipe(createWriteStream('er-tmp.csv'));

for (const [regionUrl, regionName] of Object.entries(await getRegions(new URL('https://er.ru/')))) {
    const base = new URL(regionUrl);
    const personUrls = await getPersonsUrls(base);
    for (const [url, keywords] of Object.entries(personUrls)) {
        const personUrl = new URL(url);
        const guid = personUrl.pathname.split('/').pop()!;
        if (!processedPersons[guid]) {
            process.stdout.write(`Processing ${url}...\n`);
            const person = await parsePerson(new URL(url));
            person.id = guid;
            keywords.forEach((keyword) => person.keywords.add(keyword));
            person.region = [regionName];

            processedPersons[guid] = person;
            tmpStream.write(stringify(person));
        } else {
            keywords.forEach((keyword) => processedPersons[guid]!.keywords.add(keyword));
            processedPersons[guid].region.push(regionName);
        }

        await setTimeout(100);
    }

    await setTimeout(1000);
}

tmpStream.end();

const stream = format({ includeEndRowDelimiter: true, headers: true });
stream.pipe(createWriteStream('er.csv'));
Object.values(processedPersons).forEach((person) => {
    stream.write(stringify(person));
});
stream.end();
