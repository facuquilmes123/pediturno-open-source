

"use client";

import { useState, useMemo } from 'react';
import Image from 'next/image';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { ChevronsUpDown, Check } from 'lucide-react';
import { ScrollArea } from './scroll-area';
import { cn } from '@/lib/utils';

const countries = [
  { name: 'Argentina', code: 'AR', prefix: '+54' },
  { name: 'Bolivia', code: 'BO', prefix: '+591' },
  { name: 'Chile', code: 'CL', prefix: '+56' },
  { name: 'Colombia', code: 'CO', prefix: '+57' },
  { name: 'Costa Rica', code: 'CR', prefix: '+506' },
  { name: 'Cuba', code: 'CU', prefix: '+53' },
  { name: 'Rep. Dominicana', code: 'DO', prefix: '+1' },
  { name: 'Ecuador', code: 'EC', prefix: '+593' },
  { name: 'El Salvador', code: 'SV', prefix: '+503' },
  { name: 'España', code: 'ES', prefix: '+34' },
  { name: 'Guatemala', code: 'GT', prefix: '+502' },
  { name: 'Honduras', code: 'HN', prefix: '+504' },
  { name: 'México', code: 'MX', prefix: '+52' },
  { name: 'Nicaragua', code: 'NI', prefix: '+505' },
  { name: 'Panamá', code: 'PA', prefix: '+507' },
  { name: 'Paraguay', code: 'PY', prefix: '+595' },
  { name: 'Perú', code: 'PE', prefix: '+51' },
  { name: 'Uruguay', code: 'UY', prefix: '+598' },
  { name: 'Venezuela', code: 'VE', prefix: '+58' },
].sort((a, b) => a.name.localeCompare(b.name));

interface PhoneInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  defaultCountry?: string;
}

const PhoneInput = ({ id, value, onChange, defaultCountry = 'AR' }: PhoneInputProps) => {
  const [open, setOpen] = useState(false);

  const { selectedCountry, localNumber } = useMemo(() => {
    let country = countries.find(c => value.startsWith(c.prefix));
    if (!country) {
        country = countries.find(c => c.code === defaultCountry);
    }
    const number = country ? value.replace(country.prefix, '') : value;
    return { selectedCountry: country, localNumber: number };
  }, [value, defaultCountry]);


  const handleSelectCountry = (countryCode: string) => {
    const country = countries.find(c => c.code === countryCode);
    if (country) {
      onChange(country.prefix + localNumber);
    }
    setOpen(false);
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newLocalNumber = e.target.value.replace(/\D/g, '');
    onChange((selectedCountry?.prefix || '') + newLocalNumber);
  };

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="w-[80px] justify-between flex-shrink-0">
            {selectedCountry ? (
              <Image
                src={`https://flagcdn.com/w20/${selectedCountry.code.toLowerCase()}.png`}
                alt={selectedCountry.name}
                width={20}
                height={15}
              />
            ) : (
              'País'
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[250px] p-0">
          <Command>
            <CommandInput placeholder="Buscar país..." />
            <CommandEmpty>No se encontró el país.</CommandEmpty>
            <CommandGroup>
                <ScrollArea className="h-52">
                    <CommandList>
                        {countries.map(country => (
                            <CommandItem
                            key={country.code}
                            value={country.code}
                            onSelect={handleSelectCountry}
                            >
                            <Check
                                className={cn('mr-2 h-4 w-4', selectedCountry?.code === country.code ? 'opacity-100' : 'opacity-0')}
                            />
                            <Image
                                src={`https://flagcdn.com/w20/${country.code.toLowerCase()}.png`}
                                alt={country.name}
                                width={20}
                                height={15}
                                className="mr-2"
                            />
                            <span>{country.name} ({country.prefix})</span>
                            </CommandItem>
                        ))}
                    </CommandList>
                </ScrollArea>
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
      <div className="relative flex-grow">
          {selectedCountry && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{selectedCountry.prefix}</span>}
          <Input
            id={id}
            type="tel"
            value={localNumber}
            onChange={handleNumberChange}
            placeholder={selectedCountry?.prefix === '+54' ? '9 11 2233-4455' : 'Número de teléfono'}
            className={cn(selectedCountry && "pl-12")}
          />
      </div>
    </div>
  );
};

export default PhoneInput;
