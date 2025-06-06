import type { Readable, Writable } from 'node:stream';
import { WriteStream } from 'node:tty';
import { stripVTControlCharacters as strip } from 'node:util';
import {
	ConfirmPrompt,
	GroupMultiSelectPrompt,
	MultiSelectPrompt,
	PasswordPrompt,
	SelectKeyPrompt,
	SelectPrompt,
	type State,
	TextPrompt,
	block,
	isCancel,
	settings,
	updateSettings,
} from '@clack/core';
import isUnicodeSupported from 'is-unicode-supported';
import color from 'picocolors';
import { cursor, erase } from 'sisteransi';

export { isCancel, updateSettings, settings, type ClackSettings } from '@clack/core';

const unicode = isUnicodeSupported();
const s = (c: string, fallback: string) => (unicode ? c : fallback);
const S_STEP_ACTIVE = s('◆', '*');
const S_STEP_CANCEL = s('■', 'x');
const S_STEP_ERROR = s('▲', 'x');
const S_STEP_SUBMIT = s('◇', 'o');

const S_BAR_START = s('┌', 'T');
const S_BAR = s('│', '|');
const S_BAR_END = s('└', '—');

const S_RADIO_ACTIVE = s('●', '>');
const S_RADIO_INACTIVE = s('○', ' ');
const S_CHECKBOX_ACTIVE = s('◻', '[•]');
const S_CHECKBOX_SELECTED = s('◼', '[+]');
const S_CHECKBOX_INACTIVE = s('◻', '[ ]');
const S_PASSWORD_MASK = s('▪', '•');

const S_BAR_H = s('─', '-');
const S_CORNER_TOP_RIGHT = s('╮', '+');
const S_CONNECT_LEFT = s('├', '+');
const S_CORNER_BOTTOM_RIGHT = s('╯', '+');

const S_INFO = s('●', '•');
const S_SUCCESS = s('◆', '*');
const S_WARN = s('▲', '!');
const S_ERROR = s('■', 'x');

const symbol = (state: State) => {
	switch (state) {
		case 'initial':
		case 'active':
			return color.cyan(S_STEP_ACTIVE);
		case 'cancel':
			return color.red(S_STEP_CANCEL);
		case 'error':
			return color.yellow(S_STEP_ERROR);
		case 'submit':
			return color.green(S_STEP_SUBMIT);
	}
};

interface LimitOptionsParams<TOption> extends CommonOptions {
	options: TOption[];
	maxItems: number | undefined;
	cursor: number;
	style: (option: TOption, active: boolean) => string;
}

const limitOptions = <TOption>(params: LimitOptionsParams<TOption>): string[] => {
	const { cursor, options, style } = params;
	const output: Writable = params.output ?? process.stdout;
	const rows = output instanceof WriteStream && output.rows !== undefined ? output.rows : 10;

	const paramMaxItems = params.maxItems ?? Number.POSITIVE_INFINITY;
	const outputMaxItems = Math.max(rows - 4, 0);
	// We clamp to minimum 5 because anything less doesn't make sense UX wise
	const maxItems = Math.min(outputMaxItems, Math.max(paramMaxItems, 5));
	let slidingWindowLocation = 0;

	if (cursor >= slidingWindowLocation + maxItems - 3) {
		slidingWindowLocation = Math.max(Math.min(cursor - maxItems + 3, options.length - maxItems), 0);
	} else if (cursor < slidingWindowLocation + 2) {
		slidingWindowLocation = Math.max(cursor - 2, 0);
	}

	const shouldRenderTopEllipsis = maxItems < options.length && slidingWindowLocation > 0;
	const shouldRenderBottomEllipsis =
		maxItems < options.length && slidingWindowLocation + maxItems < options.length;

	return options
		.slice(slidingWindowLocation, slidingWindowLocation + maxItems)
		.map((option, i, arr) => {
			const isTopLimit = i === 0 && shouldRenderTopEllipsis;
			const isBottomLimit = i === arr.length - 1 && shouldRenderBottomEllipsis;
			return isTopLimit || isBottomLimit
				? color.dim('...')
				: style(option, i + slidingWindowLocation === cursor);
		});
};

export interface CommonOptions {
	input?: Readable;
	output?: Writable;
}

export interface TextOptions extends CommonOptions {
	message: string;
	placeholder?: string;
	defaultValue?: string;
	initialValue?: string;
	validate?: (value: string) => string | Error | undefined;
}
export const text = (opts: TextOptions) => {
	return new TextPrompt({
		validate: opts.validate,
		placeholder: opts.placeholder,
		defaultValue: opts.defaultValue,
		initialValue: opts.initialValue,
		output: opts.output,
		input: opts.input,
		render() {
			const title = `${color.gray(S_BAR)}\n${symbol(this.state)}  ${opts.message}\n`;
			const placeholder = opts.placeholder
				? color.inverse(opts.placeholder[0]) + color.dim(opts.placeholder.slice(1))
				: color.inverse(color.hidden('_'));
			const value = !this.value ? placeholder : this.valueWithCursor;

			switch (this.state) {
				case 'error':
					return `${title.trim()}\n${color.yellow(S_BAR)}  ${value}\n${color.yellow(
						S_BAR_END
					)}  ${color.yellow(this.error)}\n`;
				case 'submit':
					return `${title}${color.gray(S_BAR)}  ${color.dim(this.value || opts.placeholder)}`;
				case 'cancel':
					return `${title}${color.gray(S_BAR)}  ${color.strikethrough(
						color.dim(this.value ?? '')
					)}${this.value?.trim() ? `\n${color.gray(S_BAR)}` : ''}`;
				default:
					return `${title}${color.cyan(S_BAR)}  ${value}\n${color.cyan(S_BAR_END)}\n`;
			}
		},
	}).prompt() as Promise<string | symbol>;
};

export interface PasswordOptions extends CommonOptions {
	message: string;
	mask?: string;
	validate?: (value: string) => string | Error | undefined;
}
export const password = (opts: PasswordOptions) => {
	return new PasswordPrompt({
		validate: opts.validate,
		mask: opts.mask ?? S_PASSWORD_MASK,
		input: opts.input,
		output: opts.output,
		render() {
			const title = `${color.gray(S_BAR)}\n${symbol(this.state)}  ${opts.message}\n`;
			const value = this.valueWithCursor;
			const masked = this.masked;

			switch (this.state) {
				case 'error':
					return `${title.trim()}\n${color.yellow(S_BAR)}  ${masked}\n${color.yellow(
						S_BAR_END
					)}  ${color.yellow(this.error)}\n`;
				case 'submit':
					return `${title}${color.gray(S_BAR)}  ${color.dim(masked)}`;
				case 'cancel':
					return `${title}${color.gray(S_BAR)}  ${color.strikethrough(color.dim(masked ?? ''))}${
						masked ? `\n${color.gray(S_BAR)}` : ''
					}`;
				default:
					return `${title}${color.cyan(S_BAR)}  ${value}\n${color.cyan(S_BAR_END)}\n`;
			}
		},
	}).prompt() as Promise<string | symbol>;
};

export interface ConfirmOptions extends CommonOptions {
	message: string;
	active?: string;
	inactive?: string;
	initialValue?: boolean;
}
export const confirm = (opts: ConfirmOptions) => {
	const active = opts.active ?? 'Yes';
	const inactive = opts.inactive ?? 'No';
	return new ConfirmPrompt({
		active,
		inactive,
		input: opts.input,
		output: opts.output,
		initialValue: opts.initialValue ?? true,
		render() {
			const title = `${color.gray(S_BAR)}\n${symbol(this.state)}  ${opts.message}\n`;
			const value = this.value ? active : inactive;

			switch (this.state) {
				case 'submit':
					return `${title}${color.gray(S_BAR)}  ${color.dim(value)}`;
				case 'cancel':
					return `${title}${color.gray(S_BAR)}  ${color.strikethrough(
						color.dim(value)
					)}\n${color.gray(S_BAR)}`;
				default: {
					return `${title}${color.cyan(S_BAR)}  ${
						this.value
							? `${color.green(S_RADIO_ACTIVE)} ${active}`
							: `${color.dim(S_RADIO_INACTIVE)} ${color.dim(active)}`
					} ${color.dim('/')} ${
						!this.value
							? `${color.green(S_RADIO_ACTIVE)} ${inactive}`
							: `${color.dim(S_RADIO_INACTIVE)} ${color.dim(inactive)}`
					}\n${color.cyan(S_BAR_END)}\n`;
				}
			}
		},
	}).prompt() as Promise<boolean | symbol>;
};

type Primitive = Readonly<string | boolean | number>;

export type Option<Value> = Value extends Primitive
	? {
			/**
			 * Internal data for this option.
			 */
			value: Value;
			/**
			 * The optional, user-facing text for this option.
			 *
			 * By default, the `value` is converted to a string.
			 */
			label?: string;
			/**
			 * An optional hint to display to the user when
			 * this option might be selected.
			 *
			 * By default, no `hint` is displayed.
			 */
			hint?: string;
		}
	: {
			/**
			 * Internal data for this option.
			 */
			value: Value;
			/**
			 * Required. The user-facing text for this option.
			 */
			label: string;
			/**
			 * An optional hint to display to the user when
			 * this option might be selected.
			 *
			 * By default, no `hint` is displayed.
			 */
			hint?: string;
		};

export interface SelectOptions<Value> extends CommonOptions {
	message: string;
	options: Option<Value>[];
	initialValue?: Value;
	maxItems?: number;
}

export const select = <Value>(opts: SelectOptions<Value>) => {
	const opt = (option: Option<Value>, state: 'inactive' | 'active' | 'selected' | 'cancelled') => {
		const label = option.label ?? String(option.value);
		switch (state) {
			case 'selected':
				return `${color.dim(label)}`;
			case 'active':
				return `${color.green(S_RADIO_ACTIVE)} ${label} ${
					option.hint ? color.dim(`(${option.hint})`) : ''
				}`;
			case 'cancelled':
				return `${color.strikethrough(color.dim(label))}`;
			default:
				return `${color.dim(S_RADIO_INACTIVE)} ${color.dim(label)}`;
		}
	};

	return new SelectPrompt({
		options: opts.options,
		input: opts.input,
		output: opts.output,
		initialValue: opts.initialValue,
		render() {
			const title = `${color.gray(S_BAR)}\n${symbol(this.state)}  ${opts.message}\n`;

			switch (this.state) {
				case 'submit':
					return `${title}${color.gray(S_BAR)}  ${opt(this.options[this.cursor], 'selected')}`;
				case 'cancel':
					return `${title}${color.gray(S_BAR)}  ${opt(
						this.options[this.cursor],
						'cancelled'
					)}\n${color.gray(S_BAR)}`;
				default: {
					return `${title}${color.cyan(S_BAR)}  ${limitOptions({
						output: opts.output,
						cursor: this.cursor,
						options: this.options,
						maxItems: opts.maxItems,
						style: (item, active) => opt(item, active ? 'active' : 'inactive'),
					}).join(`\n${color.cyan(S_BAR)}  `)}\n${color.cyan(S_BAR_END)}\n`;
				}
			}
		},
	}).prompt() as Promise<Value | symbol>;
};

export const selectKey = <Value extends string>(opts: SelectOptions<Value>) => {
	const opt = (
		option: Option<Value>,
		state: 'inactive' | 'active' | 'selected' | 'cancelled' = 'inactive'
	) => {
		const label = option.label ?? String(option.value);
		if (state === 'selected') {
			return `${color.dim(label)}`;
		}
		if (state === 'cancelled') {
			return `${color.strikethrough(color.dim(label))}`;
		}
		if (state === 'active') {
			return `${color.bgCyan(color.gray(` ${option.value} `))} ${label} ${
				option.hint ? color.dim(`(${option.hint})`) : ''
			}`;
		}
		return `${color.gray(color.bgWhite(color.inverse(` ${option.value} `)))} ${label} ${
			option.hint ? color.dim(`(${option.hint})`) : ''
		}`;
	};

	return new SelectKeyPrompt({
		options: opts.options,
		input: opts.input,
		output: opts.output,
		initialValue: opts.initialValue,
		render() {
			const title = `${color.gray(S_BAR)}\n${symbol(this.state)}  ${opts.message}\n`;

			switch (this.state) {
				case 'submit':
					return `${title}${color.gray(S_BAR)}  ${opt(
						this.options.find((opt) => opt.value === this.value) ?? opts.options[0],
						'selected'
					)}`;
				case 'cancel':
					return `${title}${color.gray(S_BAR)}  ${opt(this.options[0], 'cancelled')}\n${color.gray(
						S_BAR
					)}`;
				default: {
					return `${title}${color.cyan(S_BAR)}  ${this.options
						.map((option, i) => opt(option, i === this.cursor ? 'active' : 'inactive'))
						.join(`\n${color.cyan(S_BAR)}  `)}\n${color.cyan(S_BAR_END)}\n`;
				}
			}
		},
	}).prompt() as Promise<Value | symbol>;
};

export interface MultiSelectOptions<Value> extends CommonOptions {
	message: string;
	options: Option<Value>[];
	initialValues?: Value[];
	maxItems?: number;
	required?: boolean;
	cursorAt?: Value;
}
export const multiselect = <Value>(opts: MultiSelectOptions<Value>) => {
	const opt = (
		option: Option<Value>,
		state: 'inactive' | 'active' | 'selected' | 'active-selected' | 'submitted' | 'cancelled'
	) => {
		const label = option.label ?? String(option.value);
		if (state === 'active') {
			return `${color.cyan(S_CHECKBOX_ACTIVE)} ${label} ${
				option.hint ? color.dim(`(${option.hint})`) : ''
			}`;
		}
		if (state === 'selected') {
			return `${color.green(S_CHECKBOX_SELECTED)} ${color.dim(label)} ${
				option.hint ? color.dim(`(${option.hint})`) : ''
			}`;
		}
		if (state === 'cancelled') {
			return `${color.strikethrough(color.dim(label))}`;
		}
		if (state === 'active-selected') {
			return `${color.green(S_CHECKBOX_SELECTED)} ${label} ${
				option.hint ? color.dim(`(${option.hint})`) : ''
			}`;
		}
		if (state === 'submitted') {
			return `${color.dim(label)}`;
		}
		return `${color.dim(S_CHECKBOX_INACTIVE)} ${color.dim(label)}`;
	};

	return new MultiSelectPrompt({
		options: opts.options,
		input: opts.input,
		output: opts.output,
		initialValues: opts.initialValues,
		required: opts.required ?? true,
		cursorAt: opts.cursorAt,
		validate(selected: Value[]) {
			if (this.required && selected.length === 0)
				return `Please select at least one option.\n${color.reset(
					color.dim(
						`Press ${color.gray(color.bgWhite(color.inverse(' space ')))} to select, ${color.gray(
							color.bgWhite(color.inverse(' enter '))
						)} to submit`
					)
				)}`;
		},
		render() {
			const title = `${color.gray(S_BAR)}\n${symbol(this.state)}  ${opts.message}\n`;

			const styleOption = (option: Option<Value>, active: boolean) => {
				const selected = this.value.includes(option.value);
				if (active && selected) {
					return opt(option, 'active-selected');
				}
				if (selected) {
					return opt(option, 'selected');
				}
				return opt(option, active ? 'active' : 'inactive');
			};

			switch (this.state) {
				case 'submit': {
					return `${title}${color.gray(S_BAR)}  ${
						this.options
							.filter(({ value }) => this.value.includes(value))
							.map((option) => opt(option, 'submitted'))
							.join(color.dim(', ')) || color.dim('none')
					}`;
				}
				case 'cancel': {
					const label = this.options
						.filter(({ value }) => this.value.includes(value))
						.map((option) => opt(option, 'cancelled'))
						.join(color.dim(', '));
					return `${title}${color.gray(S_BAR)}  ${
						label.trim() ? `${label}\n${color.gray(S_BAR)}` : ''
					}`;
				}
				case 'error': {
					const footer = this.error
						.split('\n')
						.map((ln, i) =>
							i === 0 ? `${color.yellow(S_BAR_END)}  ${color.yellow(ln)}` : `   ${ln}`
						)
						.join('\n');
					return `${title + color.yellow(S_BAR)}  ${limitOptions({
						output: opts.output,
						options: this.options,
						cursor: this.cursor,
						maxItems: opts.maxItems,
						style: styleOption,
					}).join(`\n${color.yellow(S_BAR)}  `)}\n${footer}\n`;
				}
				default: {
					return `${title}${color.cyan(S_BAR)}  ${limitOptions({
						output: opts.output,
						options: this.options,
						cursor: this.cursor,
						maxItems: opts.maxItems,
						style: styleOption,
					}).join(`\n${color.cyan(S_BAR)}  `)}\n${color.cyan(S_BAR_END)}\n`;
				}
			}
		},
	}).prompt() as Promise<Value[] | symbol>;
};

export interface GroupMultiSelectOptions<Value> extends CommonOptions {
	message: string;
	options: Record<string, Option<Value>[]>;
	initialValues?: Value[];
	required?: boolean;
	cursorAt?: Value;
	selectableGroups?: boolean;
	groupSpacing?: number;
}
export const groupMultiselect = <Value>(opts: GroupMultiSelectOptions<Value>) => {
	const { selectableGroups = true, groupSpacing = 0 } = opts;
	const opt = (
		option: Option<Value>,
		state:
			| 'inactive'
			| 'active'
			| 'selected'
			| 'active-selected'
			| 'group-active'
			| 'group-active-selected'
			| 'submitted'
			| 'cancelled',
		options: Option<Value>[] = []
	) => {
		const label = option.label ?? String(option.value);
		const isItem = typeof (option as any).group === 'string';
		const next = isItem && (options[options.indexOf(option) + 1] ?? { group: true });
		const isLast = isItem && (next as any).group === true;
		const prefix = isItem ? (selectableGroups ? `${isLast ? S_BAR_END : S_BAR} ` : '  ') : '';
		const spacingPrefix =
			groupSpacing > 0 && !isItem ? `\n${color.cyan(S_BAR)}  `.repeat(groupSpacing) : '';

		if (state === 'active') {
			return `${spacingPrefix}${color.dim(prefix)}${color.cyan(S_CHECKBOX_ACTIVE)} ${label} ${
				option.hint ? color.dim(`(${option.hint})`) : ''
			}`;
		}
		if (state === 'group-active') {
			return `${spacingPrefix}${prefix}${color.cyan(S_CHECKBOX_ACTIVE)} ${color.dim(label)}`;
		}
		if (state === 'group-active-selected') {
			return `${spacingPrefix}${prefix}${color.green(S_CHECKBOX_SELECTED)} ${color.dim(label)}`;
		}
		if (state === 'selected') {
			const selectedCheckbox = isItem || selectableGroups ? color.green(S_CHECKBOX_SELECTED) : '';
			return `${spacingPrefix}${color.dim(prefix)}${selectedCheckbox} ${color.dim(label)} ${
				option.hint ? color.dim(`(${option.hint})`) : ''
			}`;
		}
		if (state === 'cancelled') {
			return `${color.strikethrough(color.dim(label))}`;
		}
		if (state === 'active-selected') {
			return `${spacingPrefix}${color.dim(prefix)}${color.green(S_CHECKBOX_SELECTED)} ${label} ${
				option.hint ? color.dim(`(${option.hint})`) : ''
			}`;
		}
		if (state === 'submitted') {
			return `${color.dim(label)}`;
		}
		const unselectedCheckbox = isItem || selectableGroups ? color.dim(S_CHECKBOX_INACTIVE) : '';
		return `${spacingPrefix}${color.dim(prefix)}${unselectedCheckbox} ${color.dim(label)}`;
	};

	return new GroupMultiSelectPrompt({
		options: opts.options,
		input: opts.input,
		output: opts.output,
		initialValues: opts.initialValues,
		required: opts.required ?? true,
		cursorAt: opts.cursorAt,
		selectableGroups,
		validate(selected: Value[]) {
			if (this.required && selected.length === 0)
				return `Please select at least one option.\n${color.reset(
					color.dim(
						`Press ${color.gray(color.bgWhite(color.inverse(' space ')))} to select, ${color.gray(
							color.bgWhite(color.inverse(' enter '))
						)} to submit`
					)
				)}`;
		},
		render() {
			const title = `${color.gray(S_BAR)}\n${symbol(this.state)}  ${opts.message}\n`;

			switch (this.state) {
				case 'submit': {
					return `${title}${color.gray(S_BAR)}  ${this.options
						.filter(({ value }) => this.value.includes(value))
						.map((option) => opt(option, 'submitted'))
						.join(color.dim(', '))}`;
				}
				case 'cancel': {
					const label = this.options
						.filter(({ value }) => this.value.includes(value))
						.map((option) => opt(option, 'cancelled'))
						.join(color.dim(', '));
					return `${title}${color.gray(S_BAR)}  ${
						label.trim() ? `${label}\n${color.gray(S_BAR)}` : ''
					}`;
				}
				case 'error': {
					const footer = this.error
						.split('\n')
						.map((ln, i) =>
							i === 0 ? `${color.yellow(S_BAR_END)}  ${color.yellow(ln)}` : `   ${ln}`
						)
						.join('\n');
					return `${title}${color.yellow(S_BAR)}  ${this.options
						.map((option, i, options) => {
							const selected =
								this.value.includes(option.value) ||
								(option.group === true && this.isGroupSelected(`${option.value}`));
							const active = i === this.cursor;
							const groupActive =
								!active &&
								typeof option.group === 'string' &&
								this.options[this.cursor].value === option.group;
							if (groupActive) {
								return opt(option, selected ? 'group-active-selected' : 'group-active', options);
							}
							if (active && selected) {
								return opt(option, 'active-selected', options);
							}
							if (selected) {
								return opt(option, 'selected', options);
							}
							return opt(option, active ? 'active' : 'inactive', options);
						})
						.join(`\n${color.yellow(S_BAR)}  `)}\n${footer}\n`;
				}
				default: {
					return `${title}${color.cyan(S_BAR)}  ${this.options
						.map((option, i, options) => {
							const selected =
								this.value.includes(option.value) ||
								(option.group === true && this.isGroupSelected(`${option.value}`));
							const active = i === this.cursor;
							const groupActive =
								!active &&
								typeof option.group === 'string' &&
								this.options[this.cursor].value === option.group;
							if (groupActive) {
								return opt(option, selected ? 'group-active-selected' : 'group-active', options);
							}
							if (active && selected) {
								return opt(option, 'active-selected', options);
							}
							if (selected) {
								return opt(option, 'selected', options);
							}
							return opt(option, active ? 'active' : 'inactive', options);
						})
						.join(`\n${color.cyan(S_BAR)}  `)}\n${color.cyan(S_BAR_END)}\n`;
				}
			}
		},
	}).prompt() as Promise<Value[] | symbol>;
};

export interface NoteOptions extends CommonOptions {
	format?: (line: string) => string;
}

const defaultNoteFormatter = (line: string): string => color.dim(line);

export const note = (message = '', title = '', opts?: NoteOptions) => {
	const format = opts?.format ?? defaultNoteFormatter;
	const lines = ['', ...message.split('\n').map(format), ''];
	const titleLen = strip(title).length;
	const output: Writable = opts?.output ?? process.stdout;
	const len =
		Math.max(
			lines.reduce((sum, ln) => {
				const line = strip(ln);
				return line.length > sum ? line.length : sum;
			}, 0),
			titleLen
		) + 2;
	const msg = lines
		.map(
			(ln) => `${color.gray(S_BAR)}  ${ln}${' '.repeat(len - strip(ln).length)}${color.gray(S_BAR)}`
		)
		.join('\n');
	output.write(
		`${color.gray(S_BAR)}\n${color.green(S_STEP_SUBMIT)}  ${color.reset(title)} ${color.gray(
			S_BAR_H.repeat(Math.max(len - titleLen - 1, 1)) + S_CORNER_TOP_RIGHT
		)}\n${msg}\n${color.gray(S_CONNECT_LEFT + S_BAR_H.repeat(len + 2) + S_CORNER_BOTTOM_RIGHT)}\n`
	);
};

export const cancel = (message = '', opts?: CommonOptions) => {
	const output: Writable = opts?.output ?? process.stdout;
	output.write(`${color.gray(S_BAR_END)}  ${color.red(message)}\n\n`);
};

export const intro = (title = '', opts?: CommonOptions) => {
	const output: Writable = opts?.output ?? process.stdout;
	output.write(`${color.gray(S_BAR_START)}  ${title}\n`);
};

export const outro = (message = '', opts?: CommonOptions) => {
	const output: Writable = opts?.output ?? process.stdout;
	output.write(`${color.gray(S_BAR)}\n${color.gray(S_BAR_END)}  ${message}\n\n`);
};

export interface LogMessageOptions extends CommonOptions {
	symbol?: string;
}
export const log = {
	message: (
		message = '',
		{ symbol = color.gray(S_BAR), output = process.stdout }: LogMessageOptions = {}
	) => {
		const parts = [`${color.gray(S_BAR)}`];
		if (message) {
			const [firstLine, ...lines] = message.split('\n');
			parts.push(`${symbol}  ${firstLine}`, ...lines.map((ln) => `${color.gray(S_BAR)}  ${ln}`));
		}
		output.write(`${parts.join('\n')}\n`);
	},
	info: (message: string, opts?: LogMessageOptions) => {
		log.message(message, { ...opts, symbol: color.blue(S_INFO) });
	},
	success: (message: string, opts?: LogMessageOptions) => {
		log.message(message, { ...opts, symbol: color.green(S_SUCCESS) });
	},
	step: (message: string, opts?: LogMessageOptions) => {
		log.message(message, { ...opts, symbol: color.green(S_STEP_SUBMIT) });
	},
	warn: (message: string, opts?: LogMessageOptions) => {
		log.message(message, { ...opts, symbol: color.yellow(S_WARN) });
	},
	/** alias for `log.warn()`. */
	warning: (message: string, opts?: LogMessageOptions) => {
		log.warn(message, opts);
	},
	error: (message: string, opts?: LogMessageOptions) => {
		log.message(message, { ...opts, symbol: color.red(S_ERROR) });
	},
};

const prefix = `${color.gray(S_BAR)}  `;

// TODO (43081j): this currently doesn't support custom `output` writables
// because we rely on `columns` existing (i.e. `process.stdout.columns).
//
// If we want to support `output` being passed in, we will need to use
// a condition like `if (output insance Writable)` to check if it has columns
export const stream = {
	message: async (
		iterable: Iterable<string> | AsyncIterable<string>,
		{ symbol = color.gray(S_BAR) }: LogMessageOptions = {}
	) => {
		process.stdout.write(`${color.gray(S_BAR)}\n${symbol}  `);
		let lineWidth = 3;
		for await (let chunk of iterable) {
			chunk = chunk.replace(/\n/g, `\n${prefix}`);
			if (chunk.includes('\n')) {
				lineWidth = 3 + strip(chunk.slice(chunk.lastIndexOf('\n'))).length;
			}
			const chunkLen = strip(chunk).length;
			if (lineWidth + chunkLen < process.stdout.columns) {
				lineWidth += chunkLen;
				process.stdout.write(chunk);
			} else {
				process.stdout.write(`\n${prefix}${chunk.trimStart()}`);
				lineWidth = 3 + strip(chunk.trimStart()).length;
			}
		}
		process.stdout.write('\n');
	},
	info: (iterable: Iterable<string> | AsyncIterable<string>) => {
		return stream.message(iterable, { symbol: color.blue(S_INFO) });
	},
	success: (iterable: Iterable<string> | AsyncIterable<string>) => {
		return stream.message(iterable, { symbol: color.green(S_SUCCESS) });
	},
	step: (iterable: Iterable<string> | AsyncIterable<string>) => {
		return stream.message(iterable, { symbol: color.green(S_STEP_SUBMIT) });
	},
	warn: (iterable: Iterable<string> | AsyncIterable<string>) => {
		return stream.message(iterable, { symbol: color.yellow(S_WARN) });
	},
	/** alias for `log.warn()`. */
	warning: (iterable: Iterable<string> | AsyncIterable<string>) => {
		return stream.warn(iterable);
	},
	error: (iterable: Iterable<string> | AsyncIterable<string>) => {
		return stream.message(iterable, { symbol: color.red(S_ERROR) });
	},
};

export interface SpinnerOptions extends CommonOptions {
	indicator?: 'dots' | 'timer';
	onCancel?: () => void;
	cancelMessage?: string;
	errorMessage?: string;
}

export interface SpinnerResult {
	start(msg?: string): void;
	stop(msg?: string, code?: number): void;
	message(msg?: string): void;
	readonly isCancelled: boolean;
}

export const spinner = ({
	indicator = 'dots',
	onCancel,
	output = process.stdout,
	cancelMessage,
	errorMessage,
}: SpinnerOptions = {}): SpinnerResult => {
	const frames = unicode ? ['◒', '◐', '◓', '◑'] : ['•', 'o', 'O', '0'];
	const delay = unicode ? 80 : 120;
	const isCI = process.env.CI === 'true';

	let unblock: () => void;
	let loop: NodeJS.Timeout;
	let isSpinnerActive = false;
	let isCancelled = false;
	let _message = '';
	let _prevMessage: string | undefined = undefined;
	let _origin: number = performance.now();

	const handleExit = (code: number) => {
		const msg =
			code > 1
				? (errorMessage ?? settings.messages.error)
				: (cancelMessage ?? settings.messages.cancel);
		isCancelled = code === 1;
		if (isSpinnerActive) {
			stop(msg, code);
			if (isCancelled && typeof onCancel === 'function') {
				onCancel();
			}
		}
	};

	const errorEventHandler = () => handleExit(2);
	const signalEventHandler = () => handleExit(1);

	const registerHooks = () => {
		// Reference: https://nodejs.org/api/process.html#event-uncaughtexception
		process.on('uncaughtExceptionMonitor', errorEventHandler);
		// Reference: https://nodejs.org/api/process.html#event-unhandledrejection
		process.on('unhandledRejection', errorEventHandler);
		// Reference Signal Events: https://nodejs.org/api/process.html#signal-events
		process.on('SIGINT', signalEventHandler);
		process.on('SIGTERM', signalEventHandler);
		process.on('exit', handleExit);
	};

	const clearHooks = () => {
		process.removeListener('uncaughtExceptionMonitor', errorEventHandler);
		process.removeListener('unhandledRejection', errorEventHandler);
		process.removeListener('SIGINT', signalEventHandler);
		process.removeListener('SIGTERM', signalEventHandler);
		process.removeListener('exit', handleExit);
	};

	const clearPrevMessage = () => {
		if (_prevMessage === undefined) return;
		if (isCI) output.write('\n');
		const prevLines = _prevMessage.split('\n');
		output.write(cursor.move(-999, prevLines.length - 1));
		output.write(erase.down(prevLines.length));
	};

	const parseMessage = (msg: string): string => {
		return msg.replace(/\.+$/, '');
	};

	const formatTimer = (origin: number): string => {
		const duration = (performance.now() - origin) / 1000;
		const min = Math.floor(duration / 60);
		const secs = Math.floor(duration % 60);
		return min > 0 ? `[${min}m ${secs}s]` : `[${secs}s]`;
	};

	const start = (msg = ''): void => {
		isSpinnerActive = true;
		unblock = block({ output });
		_message = parseMessage(msg);
		_origin = performance.now();
		output.write(`${color.gray(S_BAR)}\n`);
		let frameIndex = 0;
		let indicatorTimer = 0;
		registerHooks();
		loop = setInterval(() => {
			if (isCI && _message === _prevMessage) {
				return;
			}
			clearPrevMessage();
			_prevMessage = _message;
			const frame = color.magenta(frames[frameIndex]);

			if (isCI) {
				output.write(`${frame}  ${_message}...`);
			} else if (indicator === 'timer') {
				output.write(`${frame}  ${_message} ${formatTimer(_origin)}`);
			} else {
				const loadingDots = '.'.repeat(Math.floor(indicatorTimer)).slice(0, 3);
				output.write(`${frame}  ${_message}${loadingDots}`);
			}

			frameIndex = frameIndex + 1 < frames.length ? frameIndex + 1 : 0;
			indicatorTimer = indicatorTimer < frames.length ? indicatorTimer + 0.125 : 0;
		}, delay);
	};

	const stop = (msg = '', code = 0): void => {
		isSpinnerActive = false;
		clearInterval(loop);
		clearPrevMessage();
		const step =
			code === 0
				? color.green(S_STEP_SUBMIT)
				: code === 1
					? color.red(S_STEP_CANCEL)
					: color.red(S_STEP_ERROR);
		_message = parseMessage(msg ?? _message);
		if (indicator === 'timer') {
			output.write(`${step}  ${_message} ${formatTimer(_origin)}\n`);
		} else {
			output.write(`${step}  ${_message}\n`);
		}
		clearHooks();
		unblock();
	};

	const message = (msg = ''): void => {
		_message = parseMessage(msg ?? _message);
	};

	return {
		start,
		stop,
		message,
		get isCancelled() {
			return isCancelled;
		},
	};
};

export type PromptGroupAwaitedReturn<T> = {
	[P in keyof T]: Exclude<Awaited<T[P]>, symbol>;
};

export interface PromptGroupOptions<T> {
	/**
	 * Control how the group can be canceled
	 * if one of the prompts is canceled.
	 */
	onCancel?: (opts: {
		results: Prettify<Partial<PromptGroupAwaitedReturn<T>>>;
	}) => void;
}

type Prettify<T> = {
	[P in keyof T]: T[P];
} & {};

export type PromptGroup<T> = {
	[P in keyof T]: (opts: {
		results: Prettify<Partial<PromptGroupAwaitedReturn<Omit<T, P>>>>;
	}) => undefined | Promise<T[P] | undefined>;
};

/**
 * Define a group of prompts to be displayed
 * and return a results of objects within the group
 */
export const group = async <T>(
	prompts: PromptGroup<T>,
	opts?: PromptGroupOptions<T>
): Promise<Prettify<PromptGroupAwaitedReturn<T>>> => {
	const results = {} as any;
	const promptNames = Object.keys(prompts);

	for (const name of promptNames) {
		const prompt = prompts[name as keyof T];
		const result = await prompt({ results })?.catch((e) => {
			throw e;
		});

		// Pass the results to the onCancel function
		// so the user can decide what to do with the results
		// TODO: Switch to callback within core to avoid isCancel Fn
		if (typeof opts?.onCancel === 'function' && isCancel(result)) {
			results[name] = 'canceled';
			opts.onCancel({ results });
			continue;
		}

		results[name] = result;
	}

	return results;
};

export type Task = {
	/**
	 * Task title
	 */
	title: string;
	/**
	 * Task function
	 */
	task: (message: (string: string) => void) => string | Promise<string> | void | Promise<void>;

	/**
	 * If enabled === false the task will be skipped
	 */
	enabled?: boolean;
};

/**
 * Define a group of tasks to be executed
 */
export const tasks = async (tasks: Task[], opts?: CommonOptions) => {
	for (const task of tasks) {
		if (task.enabled === false) continue;

		const s = spinner(opts);
		s.start(task.title);
		const result = await task.task(s.message);
		s.stop(result || task.title);
	}
};
