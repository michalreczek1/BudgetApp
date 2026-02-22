const PL_DATE_FORMATTER = new Intl.DateTimeFormat('pl-PL');

export function parseDateString(dateString) {
        if (!dateString || typeof dateString !== 'string') {
            return new Date(NaN);
        }

        const value = String(dateString).trim();
        if (!value) {
            return new Date(NaN);
        }

        let year;
        let month;
        let day;

        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            [year, month, day] = value.split('-').map(Number);
        } else {
            const match = value.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
            if (!match) {
                return new Date(NaN);
            }

            day = Number(match[1]);
            month = Number(match[2]);
            year = Number(match[3]);
        }

        const parsedDate = new Date(year, month - 1, day);
        if (
            parsedDate.getFullYear() !== year ||
            parsedDate.getMonth() !== month - 1 ||
            parsedDate.getDate() !== day
        ) {
            return new Date(NaN);
        }

        return parsedDate;
}

export function formatDateString(date) {
        const parsedDate = date instanceof Date ? date : new Date(date);
        if (Number.isNaN(parsedDate.getTime())) {
            return '';
        }

        const year = parsedDate.getFullYear();
        const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
        const day = String(parsedDate.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
}

export function formatDateToPolish(dateString) {
        const parsedDate = parseDateString(dateString);
        if (Number.isNaN(parsedDate.getTime())) {
            return '';
        }
        return PL_DATE_FORMATTER.format(parsedDate);
}

export function parseUserDateToISO(inputValue) {
        const value = (inputValue || '').trim();
        if (!value) {
            return null;
        }

        const parsedDate = parseDateString(value);
        if (Number.isNaN(parsedDate.getTime())) {
            return null;
        }

        return formatDateString(parsedDate);
}
